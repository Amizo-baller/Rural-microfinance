import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ACCOUNT_ROLES, roleLabel, type AccountRole } from './account-roles';
export { ACCOUNT_ROLES, type AccountRole } from './account-roles';

export function RoleDropdown({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (role: AccountRole) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = roleLabel(value);
  return (
    <View style={styles.field}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Role: ${selected}`}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => setOpen(!open)}
        style={styles.trigger}
      >
        <Text style={styles.text}>{selected}</Text>
        <Text accessibilityElementsHidden importantForAccessibility="no">
          {open ? '▴' : '▾'}
        </Text>
      </Pressable>
      {open && !disabled && (
        <View accessibilityRole="menu" accessibilityLabel="Account roles" style={styles.menu}>
          {ACCOUNT_ROLES.map((role) => (
            <Pressable
              key={role.value}
              accessibilityRole="menuitem"
              accessibilityState={{ selected: value === role.value }}
              onPress={() => {
                onChange(role.value);
                setOpen(false);
              }}
              style={[styles.option, value === role.value && styles.selected]}
            >
              <Text style={styles.text}>{role.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  field: { marginBottom: 12 },
  trigger: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#64748B',
    borderRadius: 8,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  menu: {
    borderWidth: 1,
    borderColor: '#64748B',
    borderRadius: 8,
    marginTop: 4,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  option: { paddingVertical: 14, paddingHorizontal: 14, minHeight: 48 },
  selected: { backgroundColor: '#DBEAFE' },
  text: { color: '#172033', fontSize: 16 },
});
