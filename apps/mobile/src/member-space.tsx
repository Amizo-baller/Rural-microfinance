import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { request } from './api-client';
import { formatSle } from './dashboard';

type Group = {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  contactInfo: string | null;
  status: string;
  weeklyContributionAmount: string | null;
  withdrawalsAllowed: boolean;
};
type PayoutProvider = { providerId: string; name: string };
type Account = {
  id: string;
  accountNumber: string;
  balance: string;
  availableBalance: string;
  withdrawalFeeDue?: string;
  currency: string;
  status: string;
  canWithdraw: boolean;
};
type Overview = {
  membership: { memberNumber: string; status: string; group: Group } | null;
  accounts: Account[];
  obligations: {
    configured: boolean;
    weeklyAmount: string | null;
    totalDue: string;
    weeks: {
      weekStart: string;
      dueDate: string;
      expected: string;
      paid: string;
      remaining: string;
      status: string;
    }[];
  } | null;
};
type Row = {
  id: string;
  reference?: string;
  loanReference?: string;
  amount?: string;
  principalAmount?: string;
  currency?: string;
  status: string;
  reviewNotes?: string | null;
  payoutReference?: string | null;
  payoutFees?: string | null;
  disbursedAt?: string | null;
  blockchainStatus?: string | null;
  blockchainHash?: string | null;
  type?: string;
};
type Page<T> = { items: T[]; total: number; page: number; limit: number };
type Tab =
  | 'Overview'
  | 'Join group'
  | 'Obligations'
  | 'Withdrawals'
  | 'Payout status'
  | 'Verification records';
const tabs: Tab[] = [
  'Overview',
  'Join group',
  'Obligations',
  'Withdrawals',
  'Payout status',
  'Verification records',
];

export function MemberSpace({
  onBack,
  onPay,
  onRepay,
  onApply,
  onHistory,
  onSavings,
  onNotifications,
}: {
  onBack: () => void;
  onPay: () => void;
  onRepay: () => void;
  onApply: () => void;
  onHistory: () => void;
  onSavings: () => void;
  onNotifications: () => void;
}) {
  const [tab, setTab] = useState<Tab>('Overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [payoutProviders, setPayoutProviders] = useState<PayoutProvider[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [payoutPhone, setPayoutPhone] = useState('');
  const [providerId, setProviderId] = useState('');
  const [verification, setVerification] = useState<Record<string, string>>({});
  const operation = useRef(false);
  const sequence = useRef(0);
  // Keep the same reference on a retry after an interrupted network response.
  const withdrawalAttempt = useRef<{ key: string; reference: string } | null>(null);

  const load = useCallback(async () => {
    const ticket = ++sequence.current;
    setLoading(true);
    setError('');
    setRows([]);
    setGroups([]);
    try {
      const result = await request<Overview>('/member-space');
      let list: Page<Row> | null = null;
      let available: Page<Group> | null = null;
      let providers: PayoutProvider[] = [];
      if (tab === 'Join group')
        available = await request<Page<Group>>(`/groups?status=ACTIVE&page=${page}`);
      if (tab === 'Withdrawals')
        list = await request<Page<Row>>(`/member-space/withdrawals?page=${page}`);
      if (tab === 'Withdrawals') {
        try { providers = await request<PayoutProvider[]>('/member-space/payout-providers'); } catch { providers = []; }
      }
      if (tab === 'Payout status') list = await request<Page<Row>>(`/loans?page=${page}`);
      if (tab === 'Verification records')
        list = await request<Page<Row>>(`/financial-records?page=${page}&limit=20`);
      if (ticket !== sequence.current) return;
      setOverview(result);
      setGroups(available?.items ?? []);
      setRows(list?.items ?? []);
      setPayoutProviders(providers);
      const paged = list ?? available;
      setHasMore(Boolean(paged && page * paged.limit < paged.total));
    } catch (err) {
      if (ticket === sequence.current)
        setError(err instanceof Error ? err.message : 'Member information could not be loaded.');
    } finally {
      if (ticket === sequence.current) setLoading(false);
    }
  }, [tab, page]);
  useEffect(() => {
    void load();
    return () => {
      sequence.current += 1;
    };
  }, [load]);

  async function act(work: () => Promise<unknown>, success: string) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      setNotice(success);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action could not be completed.');
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  function withdraw() {
    if (
      !accountId ||
      !/^\d{1,12}(\.\d{1,2})?$/.test(amount) ||
      Number(amount) <= 0 ||
      reason.trim().length < 5 ||
      !providerId.trim() ||
      !/^\+?[0-9]{7,15}$/.test(payoutPhone.trim())
    ) {
      setError(
        'Select an account, enter a valid amount, provider ID and mobile money number, and a reason of at least five characters.',
      );
      return;
    }
    const account = overview?.accounts.find((item) => item.id === accountId);
    if (!account?.canWithdraw || Number(amount) > Number(account.availableBalance)) {
      setError('Choose a permitted account and an amount within its available savings.');
      return;
    }
    const key = JSON.stringify([accountId, amount, reason.trim()]);
    if (withdrawalAttempt.current?.key !== key)
      withdrawalAttempt.current = {
        key,
        reference: `WD-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
      };
    const reference = withdrawalAttempt.current.reference;
    void act(async () => {
      await request('/member-space/withdrawals', {
          body: { savingsAccountId: accountId, amount, reason: reason.trim(), reference, payoutPhone: payoutPhone.trim(), providerId: providerId.trim() },
      });
      withdrawalAttempt.current = null;
      setAmount('');
      setReason('');
    }, 'Withdrawal requested. An administrator will review it.');
  }
  const membership = overview?.membership;
  const obligations = overview?.obligations;
  const button = (label: string, action: () => void, disabled = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={[s.button, disabled && s.disabled]}
      onPress={action}
    >
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      {button('Back to dashboard', onBack, busy)}
      <Text accessibilityRole="header" style={s.heading}>
        Member workspace
      </Text>
      <View style={s.actions}>
        {tabs.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === item, disabled: busy }}
            disabled={busy}
            onPress={() => {
              setTab(item);
              setPage(1);
              setNotice('');
            }}
            style={[s.tab, tab === item && s.selected]}
          >
            <Text>{item}</Text>
          </Pressable>
        ))}
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      {!!notice && (
        <Text accessibilityLiveRegion="polite" style={s.notice}>
          {notice}
        </Text>
      )}
      {button('Refresh member information', () => void load(), loading || busy)}
      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading member information" />
      ) : (
        overview && (
          <>
            {tab === 'Overview' && (
              <>
                <View style={s.card}>
                  <Text style={s.title}>
                    {membership?.group.name ?? 'Join a community group to get started'}
                  </Text>
                  {membership && (
                    <>
                      <Text>
                        {membership.memberNumber} · {membership.status}
                      </Text>
                      <Text>{membership.group.description}</Text>
                      <Text>{membership.group.location}</Text>
                      <Text>{membership.group.contactInfo}</Text>
                      <Text>Group: {membership.group.status}</Text>
                      <Text>
                        Withdrawals:{' '}
                        {membership.group.withdrawalsAllowed
                          ? 'Permitted, subject to review'
                          : 'Not permitted'}
                      </Text>
                    </>
                  )}
                </View>
                {overview?.accounts.map((account) => (
                  <View key={account.id} style={s.card}>
                    <Text style={s.title}>{account.accountNumber}</Text>
                    <Text>
                      {account.status} · {account.currency} {account.balance}
                    </Text>
                    <Text>
                      Available after pending withdrawals: {account.currency}{' '}
                      {account.availableBalance}
                    </Text>
                    {!!Number(account.withdrawalFeeDue) && <Text>Monime fees due: SLE {account.withdrawalFeeDue}</Text>}
                  </View>
                ))}
                <View style={s.actions}>
                  {button('Pay contribution', onPay)}
                  {button('Apply for loan', onApply)}
                  {button('Repay loan', onRepay)}
                  {button('Contribution history', onHistory)}
                  {button('Savings balance', onSavings)}
                  {button('Notifications', onNotifications)}
                </View>
              </>
            )}
            {tab === 'Join group' && (
              <>
                {membership ? (
                  <Text>
                    You already belong to {membership.group.name}. Contact your group manager for
                    membership changes.
                  </Text>
                ) : (
                  <Text>Choose an active group. Your account can belong to one group.</Text>
                )}
                {groups.map((group) => (
                  <View key={group.id} style={s.card}>
                    <Text style={s.title}>{group.name}</Text>
                    <Text>{group.description}</Text>
                    <Text>
                      {group.location} · {group.contactInfo}
                    </Text>
                    <Text>
                      Weekly contribution:{' '}
                      {group.weeklyContributionAmount === null
                        ? 'Not configured'
                        : formatSle(group.weeklyContributionAmount)}
                    </Text>
                    <Text>
                      Withdrawals:{' '}
                      {group.withdrawalsAllowed ? 'Permitted subject to review' : 'Not permitted'}
                    </Text>
                    {!membership &&
                      button(
                        `Join ${group.name}`,
                        () =>
                          void act(
                            () => request(`/member-space/groups/${group.id}/join`, { body: {} }),
                            `You joined ${group.name}.`,
                          ),
                        busy,
                      )}
                  </View>
                ))}
                {groups.length === 0 && <Text>No active groups available.</Text>}
              </>
            )}
            {tab === 'Obligations' && (
              <>
                {!membership ? (
                  <Text>Join a group to view your contribution obligations.</Text>
                ) : !obligations?.configured ? (
                  <Text>
                    Your group has not configured a weekly contribution amount. Contact the group
                    manager.
                  </Text>
                ) : (
                  <>
                    <Text style={s.title}>
                      Weekly contribution: {formatSle(obligations.weeklyAmount ?? 0)}
                    </Text>
                    <Text>Remaining obligations: {formatSle(obligations.totalDue)}</Text>
                    <Text>
                      Weeks run Monday to Sunday in UTC. Confirmed payments count toward the
                      selected week. Pending payments appear in Pay contribution.
                    </Text>
                    {button('Pay contribution', onPay)}
                    {obligations.weeks.map((week) => (
                      <View key={week.weekStart} style={s.card}>
                        <Text style={s.title}>
                          {week.weekStart} to {week.dueDate} · {week.status}
                        </Text>
                        <Text>
                          Expected: {formatSle(week.expected)} · Confirmed: {formatSle(week.paid)}
                        </Text>
                        <Text>Remaining: {formatSle(week.remaining)}</Text>
                      </View>
                    ))}
                  </>
                )}
              </>
            )}
            {tab === 'Withdrawals' && (
      <>
        <Text style={s.title}>Request a withdrawal</Text>
        <Text>
          Requests reserve savings immediately. Your SLE 5 withdrawal fee is already recorded as paid. Monime calculates its variable payout fee after payout creation; you are responsible for that fee, which will be charged against remaining savings. Any uncovered amount will remain due.
                </Text>
                {overview?.accounts
                  .filter((account) => account.canWithdraw)
                  .map((account) => (
                    <Pressable
                      key={account.id}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: accountId === account.id }}
                      onPress={() => setAccountId(account.id)}
                      style={[s.tab, accountId === account.id && s.selected]}
                    >
                      <Text>
                        {account.accountNumber} · Available {account.currency}{' '}
                        {account.availableBalance}
                      </Text>
                    </Pressable>
                  ))}
                {!overview?.accounts.some((account) => account.canWithdraw) && (
                  <Text>No savings account is currently eligible for withdrawals.</Text>
                )}
        <Text>Amount (SLE)</Text>
                <TextInput
                  accessibilityLabel="Withdrawal amount"
                  style={s.input}
                  keyboardType="decimal-pad"
                  value={amount}
                  onChangeText={setAmount}
        />
        <Text>Supported mobile money provider</Text>
        {payoutProviders.map((provider) => <Pressable key={provider.providerId} accessibilityRole="radio" accessibilityState={{ checked: providerId === provider.providerId }} style={[s.tab, providerId === provider.providerId && s.selected]} onPress={() => setProviderId(provider.providerId)}><Text>{provider.name}</Text></Pressable>)}
        {!payoutProviders.length && <Text>Monime payout providers are unavailable. Refresh after live payout configuration is connected.</Text>}
        <Text>Mobile money phone number</Text>
        <TextInput accessibilityLabel="Mobile money phone number" style={s.input} keyboardType="phone-pad" value={payoutPhone} onChangeText={setPayoutPhone} />
                <Text>Reason</Text>
                <TextInput
                  accessibilityLabel="Withdrawal reason"
                  style={s.input}
                  value={reason}
                  onChangeText={setReason}
                  maxLength={1000}
                />
                {button(
                  'Submit withdrawal request',
                  withdraw,
                  busy || !overview?.accounts.some((account) => account.canWithdraw),
                )}
                <Text style={s.title}>Withdrawal status</Text>
                {rows.map((row) => (
                  <View key={row.id} style={s.card}>
                    <Text>
                      {row.reference} · {row.status === 'COMPLETED' ? 'Withdrawal successful' : row.status === 'REJECTED' ? 'Withdrawal rejected' : row.status === 'FAILED' ? 'Withdrawal failed' : row.status === 'PROCESSING' || row.status === 'APPROVED' ? 'Processing' : row.status === 'PENDING' ? 'Pending approval' : row.status}
                    </Text>
                    <Text>{formatSle(row.amount ?? 0)}</Text>
                    <Text>{row.reviewNotes}</Text>
                    {row.payoutFees && <Text>Monime payout fee: SLE {row.payoutFees}</Text>}
                    {row.payoutReference && <Text>Provider reference: {row.payoutReference}</Text>}
                  </View>
                ))}
                {!rows.length && <Text>No withdrawal requests.</Text>}
              </>
            )}
            {tab === 'Payout status' && (
              <>
                <Text style={s.title}>Loan payout status</Text>
                <Text>
                  Loan status and disbursement dates come from the recorded loan. View Withdrawals
                  for savings withdrawal decisions.
                </Text>
                {rows.map((row) => (
                  <View key={row.id} style={s.card}>
                    <Text style={s.title}>{row.loanReference}</Text>
                    <Text>
                      {row.currency} {row.principalAmount} · {row.status}
                    </Text>
                    <Text>
                      {row.disbursedAt
                        ? `Disbursed: ${new Date(row.disbursedAt).toLocaleDateString()}`
                        : 'Awaiting disbursement'}
                    </Text>
                  </View>
                ))}
                {!rows.length && (
                  <Text>No loans recorded. Check Loans for application status.</Text>
                )}
              </>
            )}
            {tab === 'Verification records' && (
              <>
                <Text>
                  Verify your financial records against the blockchain. Records without a confirmed
                  proof remain pending.
                </Text>
                {rows.map((row) => (
                  <View key={row.id} style={s.card}>
                    <Text style={s.title}>{row.reference}</Text>
                    <Text>
                      {row.type} · {row.currency} {row.amount}
                    </Text>
                    <Text>Blockchain: {row.blockchainStatus ?? 'Not recorded'}</Text>
                    <Text selectable>{row.blockchainHash}</Text>
                    {button(
                      `Verify ${row.reference}`,
                      () =>
                        void act(async () => {
                          const result = await request<{ verificationResult: string }>(
                            `/blockchain/verify/${row.id}`,
                          );
                          setVerification((current) => ({
                            ...current,
                            [row.id]: result.verificationResult,
                          }));
                        }, 'Verification complete.'),
                      busy,
                    )}
                    {verification[row.id] && (
                      <Text accessibilityLiveRegion="polite">Result: {verification[row.id]}</Text>
                    )}
                  </View>
                ))}
                {!rows.length && <Text>No financial records yet.</Text>}
              </>
            )}
            {['Join group', 'Withdrawals', 'Payout status', 'Verification records'].includes(
              tab,
            ) && (
              <View style={s.actions}>
                {button('Previous page', () => setPage(page - 1), page === 1 || busy)}
                <Text>Page {page}</Text>
                {button('Next page', () => setPage(page + 1), !hasMore || busy)}
              </View>
            )}
          </>
        )
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F7FB' },
  content: { padding: 24, gap: 14, maxWidth: 1000, width: '100%', alignSelf: 'center' },
  heading: { fontSize: 28, fontWeight: '700', color: '#172033' },
  title: { fontSize: 18, fontWeight: '600', color: '#172033' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  button: { backgroundColor: '#2158B0', padding: 13, borderRadius: 10, alignSelf: 'flex-start' },
  buttonText: { color: '#FFFFFF', fontWeight: '600' },
  tab: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A8B5C8',
    backgroundColor: '#FFFFFF',
  },
  selected: { backgroundColor: '#DCEAFE', borderColor: '#2158B0' },
  card: { padding: 18, gap: 8, backgroundColor: '#FFFFFF', borderRadius: 12 },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#A8B5C8',
    padding: 12,
    borderRadius: 8,
  },
  error: { color: '#B42318' },
  notice: { color: '#14633C' },
  disabled: { opacity: 0.5 },
});
