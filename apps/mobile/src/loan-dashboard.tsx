import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { DashboardIcon, dashboardGroupName, formatSle } from './dashboard';

type LoanOverview = {
  id: string;
  loanReference: string;
  principalAmount: number | string;
  outstandingBalance: number | string;
  termMonths: number;
  startDate: string | null;
  dueDate: string | null;
  status: string;
};
type Props = {
  loans: LoanOverview[];
  repayments: { amount: number | string; status: string; loan: { loanReference: string } }[];
  applications: {
    id: string;
    requestedAmount: number | string;
    status: string;
    termMonths: number;
    purpose: string;
    submittedAt: string | null;
    reviewerNotes: string | null;
    group: { name: string };
  }[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onHome: () => void;
  onLoans: () => void;
  onBack: () => void;
  onSavings?: () => void;
  onActivity?: () => void;
  onApply?: () => void;
  onRepay?: () => void;
  onHistory: () => void;
  onDetails: (id: string) => void;
  onLoadMore?: () => void;
  loadingMore: boolean;
};

function dateLabel(value: string | null) {
  return value
    ? new Date(value).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : 'Not available';
}

export function LoanDashboard(props: Props) {
  const loan = props.loans.find((item) => item.status === 'ACTIVE') ?? props.loans[0];
  const paid = loan
    ? props.repayments
        .filter(
          (item) => item.loan.loanReference === loan.loanReference && item.status === 'CONFIRMED',
        )
        .reduce((sum, item) => sum + Number(item.amount), 0)
    : 0;
  const remaining = loan ? Number(loan.outstandingBalance) : 0;
  const progress =
    paid + remaining > 0
      ? Math.min(100, Math.max(0, Math.round((paid / (paid + remaining)) * 100)))
      : 0;
  const nav = [
    { label: 'Home', icon: 'home' as const, onPress: props.onHome },
    { label: 'Savings', icon: 'coins' as const, onPress: props.onSavings },
    { label: 'Loans', icon: 'loan' as const, onPress: props.onLoans, active: true },
    { label: 'Activity', icon: 'history' as const, onPress: props.onActivity },
  ].filter((item) => item.onPress);

  return (
    <View style={s.root}>
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={props.refreshing}
            onRefresh={props.onRefresh}
            tintColor="#006B4E"
          />
        }
      >
        <View style={s.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to profile"
            onPress={props.onBack}
            style={s.back}
          >
            <DashboardIcon name="back" color="#0B1026" size={28} />
          </Pressable>
          <Text accessibilityRole="header" aria-level={1} style={s.title}>
            My Loans
          </Text>
          <View style={s.back} />
        </View>
        {props.loading ? (
          <ActivityIndicator
            accessibilityLabel="Loading loans"
            color="#006B4E"
            size="large"
            style={s.loading}
          />
        ) : loan ? (
          <>
            <View style={s.card}>
              <View style={s.loanHeader}>
                <View style={s.iconBadge}>
                  <DashboardIcon name="sprout" color="#009853" size={32} />
                </View>
                <Text accessibilityRole="header" aria-level={2} style={s.loanTitle}>
                  {loan.status === 'ACTIVE' ? 'Active loan' : 'Loan overview'}
                </Text>
                <View style={[s.status, loan.status !== 'ACTIVE' && s.otherStatus]}>
                  <Text style={s.statusText}>
                    {loan.status.charAt(0) +
                      loan.status.slice(1).toLowerCase().replaceAll('_', ' ')}
                  </Text>
                </View>
              </View>
              <View style={s.balanceRow}>
                <View style={s.balanceColumn}>
                  <Text style={s.muted}>Outstanding balance</Text>
                  <Text style={s.balance}>{formatSle(loan.outstandingBalance)}</Text>
                </View>
                <View style={[s.balanceColumn, s.nextColumn]}>
                  <Text style={s.muted}>Next payment</Text>
                  <Text style={s.nextAmount}>Not scheduled</Text>
                  {loan.dueDate && <Text style={s.due}>Final due: {dateLabel(loan.dueDate)}</Text>}
                </View>
              </View>
              <View style={s.details}>
                <DashboardIcon name="calendar" size={27} />
                <View style={s.detailRows}>
                  <View style={s.detailRow}>
                    <Text style={s.muted}>Loan amount</Text>
                    <Text style={s.detailValue}>{formatSle(loan.principalAmount)}</Text>
                  </View>
                  <View style={s.detailRow}>
                    <Text style={s.muted}>Start date</Text>
                    <Text style={s.detailValue}>{dateLabel(loan.startDate)}</Text>
                  </View>
                  <View style={s.detailRow}>
                    <Text style={s.muted}>Term</Text>
                    <Text style={s.detailValue}>
                      {loan.termMonths} {loan.termMonths === 1 ? 'month' : 'months'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </>
        ) : (
          <View style={s.card}>
            <Text accessibilityRole="header" aria-level={2} style={s.loanTitle}>
              No active loan
            </Text>
            <Text style={s.empty}>No created loans found.</Text>
          </View>
        )}

        {loan?.status === 'ACTIVE' && remaining > 0 && props.onRepay && !props.loading && (
          <Pressable accessibilityRole="button" onPress={props.onRepay} style={s.primary}>
            <DashboardIcon name="card" color="#FFFFFF" size={27} />
            <Text style={s.primaryText}>Repay loan</Text>
          </Pressable>
        )}
        {props.onApply && (
          <Pressable accessibilityRole="button" onPress={props.onApply} style={s.outline}>
            <DashboardIcon name="history" size={27} />
            <Text style={s.outlineText}>Apply for a loan</Text>
          </Pressable>
        )}

        {loan && !props.loading && (
          <View style={[s.card, s.progressCard]}>
            <View style={s.progressHeader}>
              <Text accessibilityRole="header" aria-level={2} style={s.sectionTitle}>
                Repayment progress
              </Text>
              <Text style={s.percent}>{progress}%</Text>
            </View>
            <View
              accessibilityRole="progressbar"
              accessibilityLabel="Repayment progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-valuetext={`${progress}% repaid`}
              accessibilityValue={{ min: 0, max: 100, now: progress, text: `${progress}% repaid` }}
              style={s.track}
            >
              <View style={[s.fill, { width: `${progress}%` }]} />
            </View>
            <View style={s.progressTotals}>
              <View style={s.totalColumn}>
                <Text style={s.total}>{formatSle(paid)}</Text>
                <Text style={s.muted}>Amount paid</Text>
              </View>
              <View style={[s.totalColumn, s.remaining]}>
                <Text style={s.total}>{formatSle(loan.outstandingBalance)}</Text>
                <Text style={s.muted}>Remaining balance</Text>
              </View>
            </View>
          </View>
        )}

        <View style={s.extraActions}>
          {loan && (
            <Pressable
              accessibilityRole="button"
              onPress={() => props.onDetails(loan.id)}
              style={s.utility}
            >
              <Text style={s.link}>View loan details</Text>
            </Pressable>
          )}
          <Pressable accessibilityRole="button" onPress={props.onHistory} style={s.utility}>
            <Text style={s.link}>View repayments</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={props.onRefresh}
            disabled={props.refreshing}
            style={s.utility}
          >
            <Text style={s.link}>{props.refreshing ? 'Refreshing...' : 'Refresh'}</Text>
          </Pressable>
        </View>
        {props.loans
          .filter((item) => item.id !== loan?.id)
          .map((item) => (
            <View key={item.id} style={s.card}>
              <Text style={s.sectionTitle}>{item.loanReference}</Text>
              <Text style={s.empty}>
                {item.status.replaceAll('_', ' ')} · {formatSle(item.outstandingBalance)}{' '}
                outstanding
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => props.onDetails(item.id)}
                style={s.utility}
              >
                <Text style={s.link}>View loan details</Text>
              </Pressable>
            </View>
          ))}
        <Text accessibilityRole="header" aria-level={2} style={s.sectionTitle}>
          Application history
        </Text>
        {!props.loading && !props.applications.length && (
          <Text style={s.empty}>No loan applications found.</Text>
        )}
        {props.applications.map((item) => (
          <View key={item.id} style={s.application}>
            <Text style={s.applicationTitle}>
              {formatSle(item.requestedAmount)} · {item.status.replaceAll('_', ' ')}
            </Text>
            <Text style={s.muted}>
              {dashboardGroupName(item.group.name)} · {item.termMonths} months
              {item.submittedAt ? ` · ${dateLabel(item.submittedAt)}` : ''}
            </Text>
            <Text style={s.empty}>
              {item.purpose}
              {item.reviewerNotes ? ` · Review: ${item.reviewerNotes}` : ''}
            </Text>
          </View>
        ))}
        {props.onLoadMore && (
          <Pressable
            accessibilityRole="button"
            onPress={props.onLoadMore}
            disabled={props.loadingMore}
            style={s.outline}
          >
            <Text style={s.outlineText}>{props.loadingMore ? 'Loading...' : 'Load more'}</Text>
          </Pressable>
        )}
      </ScrollView>
      <View style={s.nav}>
        {nav.map((item) => (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            accessibilityState={{ selected: Boolean(item.active) }}
            aria-current={item.active ? 'page' : undefined}
            onPress={item.onPress}
            style={s.navItem}
          >
            <DashboardIcon name={item.icon} color={item.active ? '#006B4E' : '#657184'} size={27} />
            <Text style={[s.navText, item.active && s.activeNav]}>{item.label}</Text>
            {item.active && <View style={s.activeLine} />}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6FBF9' },
  content: {
    flexGrow: 1,
    padding: 16,
    paddingTop: 12,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  back: { width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: '#0B1026', flexShrink: 1 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 14, marginBottom: 12 },
  loanHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#EAF8F1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loanTitle: { fontSize: 20, fontWeight: '700', color: '#0B1026', flexGrow: 1, flexShrink: 1 },
  status: {
    backgroundColor: '#008F45',
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  otherStatus: { backgroundColor: '#526276' },
  statusText: { color: '#FFFFFF', fontSize: 19, fontWeight: '700' },
  balanceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  balanceColumn: { flexGrow: 1, flexBasis: 140 },
  nextColumn: { borderLeftWidth: 1, borderLeftColor: '#E1E7EC', paddingLeft: 12, flexBasis: 110 },
  muted: { color: '#526276', fontSize: 14, lineHeight: 21 },
  balance: { color: '#0B1026', fontWeight: '800', fontSize: 23, marginTop: 7 },
  nextAmount: { color: '#0B1026', fontWeight: '700', fontSize: 14, lineHeight: 20, marginTop: 7 },
  due: { color: '#526276', fontSize: 11, lineHeight: 16, marginTop: 5 },
  details: {
    flexDirection: 'row',
    gap: 12,
    borderRadius: 16,
    backgroundColor: '#EDF9F3',
    padding: 10,
  },
  detailRows: { flex: 1, gap: 4 },
  detailRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6 },
  detailValue: { color: '#0B1026', fontSize: 14, lineHeight: 21, flexShrink: 1 },
  primary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#006347',
    borderRadius: 16,
    padding: 16,
    minHeight: 60,
    marginBottom: 12,
  },
  primaryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 21 },
  outline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#007052',
    borderRadius: 16,
    padding: 14,
    minHeight: 56,
    marginBottom: 16,
  },
  outlineText: { color: '#006B4E', fontWeight: '700', fontSize: 19 },
  progressCard: { marginTop: 2, paddingVertical: 16 },
  progressHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 14,
  },
  sectionTitle: { color: '#0B1026', fontWeight: '700', fontSize: 19 },
  percent: { color: '#0B1026', fontWeight: '800', fontSize: 21 },
  track: {
    height: 18,
    borderRadius: 12,
    backgroundColor: '#DFE7EB',
    overflow: 'hidden',
    marginBottom: 14,
  },
  fill: { height: '100%', borderRadius: 12, backgroundColor: '#008D63' },
  progressTotals: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  totalColumn: { flexGrow: 1, flexBasis: 125, gap: 6 },
  remaining: { alignItems: 'flex-end' },
  total: { color: '#0B1026', fontSize: 18, fontWeight: '800' },
  empty: { color: '#526276', fontSize: 14, lineHeight: 22, marginTop: 6 },
  extraActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  utility: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  link: { color: '#006B4E', fontSize: 14, fontWeight: '600' },
  application: { padding: 16, marginTop: 10, backgroundColor: '#FFFFFF', borderRadius: 16, gap: 5 },
  applicationTitle: { fontWeight: '700', fontSize: 16, color: '#0B1026' },
  loading: { marginVertical: 30 },
  nav: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#EDF3F0',
    paddingTop: 9,
    paddingBottom: 8,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  navItem: { flex: 1, alignItems: 'center', minHeight: 62, gap: 4, paddingHorizontal: 2 },
  navText: { color: '#657184', fontSize: 14 },
  activeNav: { color: '#006B4E', fontWeight: '700' },
  activeLine: { height: 3, width: 44, borderRadius: 3, backgroundColor: '#006B4E', marginTop: 3 },
});
