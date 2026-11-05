import { useState } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { calendarDays, dateLabel, dateParts, selectableDate, todayDate } from './calendar-date';

type Props = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  disabled?: boolean;
  clearable?: boolean;
  minDate?: string;
  maxDate?: string;
};
const months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function DateField({
  label,
  value,
  onChangeText,
  disabled = false,
  clearable = true,
  minDate,
  maxDate,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [view, setView] = useState({ year: 2000, month: 0 });
  const [panel, setPanel] = useState<'days' | 'months' | 'years'>('days');
  const [yearStart, setYearStart] = useState(2000);
  const today = todayDate();
  const allowed = (date: string) => selectableDate(date, minDate, maxDate);
  function show() {
    Keyboard.dismiss();
    const initial = allowed(value)
      ? value
      : minDate && today < minDate
        ? minDate
        : maxDate && today > maxDate
          ? maxDate
          : today;
    const parts = dateParts(initial)!;
    setDraft(initial);
    setView({ year: parts.year, month: parts.month });
    setYearStart(Math.floor((parts.year - 1) / 12) * 12 + 1);
    setPanel('days');
    setOpen(true);
  }
  function monthAllowed(year: number, month: number) {
    return calendarDays(year, month).some((date) => date !== null && allowed(date));
  }
  function moveMonth(offset: number) {
    const index = view.year * 12 + view.month + offset;
    setView({ year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 });
  }
  function action(
    text: string,
    onPress: () => void,
    inactive = false,
    primary = false,
    display = text,
  ) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={text}
        disabled={inactive}
        accessibilityState={{ disabled: inactive }}
        onPress={onPress}
        style={[s.action, primary && s.primary, inactive && s.disabled]}
      >
        <Text style={[s.actionText, primary && s.white]}>{display}</Text>
      </Pressable>
    );
  }
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Open the calendar to select a year, month and day"
        accessibilityState={{ disabled, expanded: open }}
        accessibilityValue={{ text: value || 'No date selected' }}
        disabled={disabled}
        onPress={show}
        style={[s.input, disabled && s.disabled]}
      >
        <Text style={[s.value, !value && s.placeholder]}>{dateLabel(value) || 'Select date'}</Text>
        <Text accessible={false} style={s.icon}>
          ▦
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={s.overlay}>
          <View
            role="dialog"
            accessibilityLabel={`Select ${label}`}
            accessibilityViewIsModal
            aria-modal={true}
            onAccessibilityEscape={() => setOpen(false)}
            style={s.dialog}
          >
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
              <Text accessibilityRole="header" style={s.title}>
                {label}
              </Text>
              <Text accessibilityLiveRegion="polite" style={s.chosen}>
                {dateLabel(draft)}
              </Text>
              <View style={s.navigation}>
                {action(
                  'Previous month',
                  () => moveMonth(-1),
                  panel !== 'days' ||
                    (view.year === 1 && view.month === 0) ||
                    !monthAllowed(
                      view.month === 0 ? view.year - 1 : view.year,
                      (view.month + 11) % 12,
                    ),
                  false,
                  '‹',
                )}
                <View style={s.heading}>
                  {action(months[view.month], () =>
                    setPanel(panel === 'months' ? 'days' : 'months'),
                  )}
                  {action(String(view.year), () => {
                    setYearStart(Math.floor((view.year - 1) / 12) * 12 + 1);
                    setPanel(panel === 'years' ? 'days' : 'years');
                  })}
                </View>
                {action(
                  'Next month',
                  () => moveMonth(1),
                  panel !== 'days' ||
                    (view.year === 9999 && view.month === 11) ||
                    !monthAllowed(
                      view.month === 11 ? view.year + 1 : view.year,
                      (view.month + 1) % 12,
                    ),
                  false,
                  '›',
                )}
              </View>
              {panel === 'days' && (
                <>
                  <View style={s.grid}>
                    {weekdays.map((day) => (
                      <Text key={day} style={s.weekday}>
                        {day}
                      </Text>
                    ))}
                  </View>
                  <View style={s.grid}>
                    {calendarDays(view.year, view.month).map((date, index) =>
                      date === null ? (
                        <View key={`blank-${index}`} style={s.day} />
                      ) : (
                        <Pressable
                          key={date}
                          accessibilityRole="button"
                          accessibilityLabel={date}
                          accessibilityState={{
                            selected: draft === date,
                            disabled: !allowed(date),
                          }}
                          disabled={!allowed(date)}
                          onPress={() => setDraft(date)}
                          style={[
                            s.day,
                            draft === date && s.selected,
                            !allowed(date) && s.disabled,
                          ]}
                        >
                          <Text
                            style={[
                              s.dayText,
                              draft === date && s.white,
                              date === today && s.today,
                            ]}
                          >
                            {Number(date.slice(-2))}
                          </Text>
                        </Pressable>
                      ),
                    )}
                  </View>
                </>
              )}
              {panel === 'months' && (
                <View style={s.grid}>
                  {months.map((month, index) => (
                    <Pressable
                      key={month}
                      accessibilityRole="button"
                      accessibilityLabel={`Choose ${month}`}
                      accessibilityState={{
                        selected: index === view.month,
                        disabled: !monthAllowed(view.year, index),
                      }}
                      disabled={!monthAllowed(view.year, index)}
                      onPress={() => {
                        setView((current) => ({ ...current, month: index }));
                        setPanel('days');
                      }}
                      style={[
                        s.option,
                        index === view.month && s.selected,
                        !monthAllowed(view.year, index) && s.disabled,
                      ]}
                    >
                      <Text style={[s.dayText, index === view.month && s.white]}>
                        {month.slice(0, 3)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
              {panel === 'years' && (
                <>
                  <View style={s.yearNavigation}>
                    {action(
                      'Earlier years',
                      () => setYearStart(Math.max(1, yearStart - 12)),
                      yearStart === 1,
                    )}
                    <Text style={s.range}>
                      {yearStart}–{Math.min(yearStart + 11, 9999)}
                    </Text>
                    {action(
                      'Later years',
                      () => setYearStart(yearStart + 12),
                      yearStart + 12 > 9999,
                    )}
                  </View>
                  <View style={s.grid}>
                    {Array.from(
                      { length: Math.min(12, 10000 - yearStart) },
                      (_, index) => yearStart + index,
                    ).map((year) => {
                      const unavailable = Boolean(
                        (minDate && year < Number(minDate.slice(0, 4))) ||
                        (maxDate && year > Number(maxDate.slice(0, 4))),
                      );
                      return (
                        <Pressable
                          key={year}
                          accessibilityRole="button"
                          accessibilityLabel={`Choose year ${year}`}
                          accessibilityState={{
                            selected: year === view.year,
                            disabled: unavailable,
                          }}
                          disabled={unavailable}
                          onPress={() => {
                            setView((current) => ({ ...current, year }));
                            setPanel('months');
                          }}
                          style={[
                            s.option,
                            year === view.year && s.selected,
                            unavailable && s.disabled,
                          ]}
                        >
                          <Text style={[s.dayText, year === view.year && s.white]}>{year}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}
              <View style={s.footer}>
                {action(
                  'Today',
                  () => {
                    const parts = dateParts(today)!;
                    setDraft(today);
                    setView({ year: parts.year, month: parts.month });
                    setPanel('days');
                  },
                  !allowed(today),
                )}
                {clearable &&
                  action('Clear date', () => {
                    onChangeText('');
                    setOpen(false);
                  })}
                {action('Cancel', () => setOpen(false))}
                {action(
                  'Done',
                  () => {
                    if (allowed(draft)) {
                      onChangeText(draft);
                      setOpen(false);
                    }
                  },
                  !allowed(draft),
                  true,
                )}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  field: { marginBottom: 14 },
  label: { fontSize: 16, fontWeight: '600', color: '#334155', marginBottom: 8 },
  input: {
    minHeight: 54,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#94A3B8',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  value: { color: '#17212B', fontSize: 16, flex: 1 },
  placeholder: { color: '#526274' },
  icon: { fontSize: 26, color: '#0F766E' },
  overlay: {
    flex: 1,
    padding: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dialog: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '95%',
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  content: { padding: 16 },
  title: { fontSize: 20, fontWeight: '700', color: '#123D36' },
  chosen: { fontSize: 16, color: '#334155', marginTop: 8, marginBottom: 12 },
  navigation: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    gap: 4,
  },
  heading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: {
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionText: { color: '#0B6257', fontSize: 14, fontWeight: '600' },
  primary: { backgroundColor: '#0F766E' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  weekday: {
    width: '14.285714%',
    textAlign: 'center',
    color: '#526274',
    paddingVertical: 8,
    fontSize: 12,
    fontWeight: '600',
  },
  day: {
    width: '14.285714%',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  dayText: { fontSize: 16, color: '#17212B' },
  selected: { backgroundColor: '#0F766E' },
  white: { color: '#FFFFFF' },
  today: { fontWeight: '800', textDecorationLine: 'underline' },
  disabled: { opacity: 0.35 },
  option: {
    width: '33.333333%',
    minHeight: 48,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  yearNavigation: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  range: { color: '#334155', fontSize: 14 },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 12,
  },
});
