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
import { DateField } from './date-field';
import { formatSle } from './dashboard';

type FinanceReview = {
  newValues: { decision?: string; notes?: string };
  createdAt: string;
  user: { firstName: string; lastName: string } | null;
};
type Row = {
  id: string;
  reference?: string;
  loanReference?: string;
  status: string;
  amount?: string;
  requestedAmount?: string;
  principalAmount?: string;
  outstandingBalance?: string;
  currency?: string;
  purpose?: string;
  termMonths?: number;
  loan?: { id: string } | null;
  financeReview?: FinanceReview | null;
  reason?: string;
  reviewNotes?: string;
  savingsAccount?: {
    accountNumber: string;
    currency: string;
    groupMember: { user: { firstName: string; lastName: string } };
  };
  group?: { name: string };
  groupMember?: { user: { firstName: string; lastName: string } };
};
type Page = { items: Row[]; page: number; limit: number; total: number };
type Queue = 'Withdrawals' | 'Approved applications' | 'Loan operations';
const endpoints: Record<Queue, string> = {
  Withdrawals: '/admin/withdrawals',
  'Approved applications': '/loans/applications?status=APPROVED',
  'Loan operations': '/loans',
};

export function TreasurerConsole({
  onBack,
  onRecordContribution,
  onVerifyContributions,
  onReports,
  onHistory,
}: {
  onBack: () => void;
  onRecordContribution: () => void;
  onVerifyContributions: () => void;
  onReports: () => void;
  onHistory: () => void;
}) {
  const [queue, setQueue] = useState<Queue>('Withdrawals');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const sequence = useRef(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [review, setReview] = useState<Row | null>(null);
  const [decision, setDecision] = useState<'RECOMMEND_APPROVAL' | 'RECOMMEND_REJECTION'>(
    'RECOMMEND_APPROVAL',
  );
  const [notes, setNotes] = useState('');
  const [application, setApplication] = useState<Row | null>(null);
  const [interestRate, setInterestRate] = useState('0');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [disbursement, setDisbursement] = useState<Row | null>(null);

  const load = useCallback(async () => {
    const ticket = ++sequence.current;
    setLoading(true);
    setError('');
    setData(null);
    try {
      const endpoint = endpoints[queue];
      const result = await request<Page>(
        `${endpoint}${endpoint.includes('?') ? '&' : '?'}page=${page}&limit=25`,
      );
      if (ticket === sequence.current) setData(result);
    } catch (failure) {
      if (ticket === sequence.current)
        setError(
          failure instanceof Error ? failure.message : 'Could not load financial operations',
        );
    } finally {
      if (ticket === sequence.current) setLoading(false);
    }
  }, [queue, page]);
  useEffect(() => {
    void load();
    return () => {
      sequence.current++;
    };
  }, [load]);
  function changeQueue(next: Queue) {
    sequence.current++;
    setQueue(next);
    setPage(1);
    setReview(null);
    setApplication(null);
    setDisbursement(null);
    setError('');
    setNotice('');
  }
  async function submit(path: string, body: object) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request(path, { method: 'POST', body });
      setReview(null);
      setApplication(null);
      setDisbursement(null);
      setNotice('Financial operation saved.');
      await load();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Could not save the financial operation',
      );
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  function submitReview() {
    if (!review) return;
    if (notes.trim().length < 5) {
      setError('Enter review notes of at least five characters.');
      return;
    }
    void submit(`/admin/withdrawals/${review.id}/finance-review`, {
      decision,
      notes: notes.trim(),
    });
  }
  function createLoan() {
    if (!application) return;
    if (!/^\d+(\.\d{1,4})?$/.test(interestRate) || !startDate || !dueDate || dueDate <= startDate) {
      setError('Enter a valid interest rate and a due date after the start date.');
      return;
    }
    void submit(`/loans/applications/${application.id}/loan`, { interestRate, startDate, dueDate });
  }
  function button(label: string, action: () => void, disabled = false) {
    return (
      <Pressable
        key={label}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy || disabled }}
        disabled={busy || disabled}
        style={[s.button, (busy || disabled) && s.disabled]}
        onPress={action}
      >
        <Text style={s.buttonText}>{label}</Text>
      </Pressable>
    );
  }
  return (
    <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" aria-level={1} style={s.heading}>
        Treasurer workspace
      </Text>
      {button('Back to dashboard', onBack)}
      <View style={s.actions}>
        {button('Record contribution', onRecordContribution)}
        {button('Verify contributions', onVerifyContributions)}
        {button('Generate financial reports', onReports)}
        {button('Financial history', onHistory)}
      </View>
      <View style={s.actions}>
        {(['Withdrawals', 'Approved applications', 'Loan operations'] as Queue[]).map((name) =>
          button(name, () => changeQueue(name)),
        )}
      </View>
      <Text accessibilityRole="header" aria-level={2} style={s.title}>
        {queue}
      </Text>
      {button('Refresh operations', () => void load(), loading)}
      {queue === 'Withdrawals' && (
        <Text style={s.detail}>
          Review pending requests and send your recommendation to Admin. The final approval updates
          savings balances.
        </Text>
      )}
      {queue === 'Approved applications' && (
        <Text style={s.detail}>
          Set up loan records from applications already approved by an authorized reviewer.
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      {!!notice && (
        <Text accessibilityLiveRegion="polite" style={s.success}>
          {notice}
        </Text>
      )}
      {(loading || busy) && (
        <ActivityIndicator
          accessibilityLabel={busy ? 'Saving financial operation' : 'Loading financial operations'}
        />
      )}
      {review && (
        <View style={s.card}>
          <Text style={s.title}>Review withdrawal {review.reference}</Text>
          <Text style={s.detail}>
            {review.savingsAccount?.currency} {review.amount} ·{' '}
            {review.savingsAccount?.accountNumber}
          </Text>
          <View style={s.actions}>
            {button(
              decision === 'RECOMMEND_APPROVAL' ? '● Recommend approval' : 'Recommend approval',
              () => setDecision('RECOMMEND_APPROVAL'),
            )}
            {button(
              decision === 'RECOMMEND_REJECTION' ? '● Recommend rejection' : 'Recommend rejection',
              () => setDecision('RECOMMEND_REJECTION'),
            )}
          </View>
          <TextInput
            accessibilityLabel="Withdrawal review notes"
            style={s.input}
            value={notes}
            onChangeText={setNotes}
            multiline
            editable={!busy}
            placeholder="Explain your recommendation"
          />
          <View style={s.actions}>
            {button('Submit financial review', submitReview)}
            {button('Cancel review', () => setReview(null))}
          </View>
        </View>
      )}
      {application && (
        <View style={s.card}>
          <Text style={s.title}>Create approved loan record</Text>
          <Text style={s.detail}>
            {formatSle(application.requestedAmount ?? '0')} · {application.termMonths} months
          </Text>
          <Text style={s.detail}>Interest rate (%)</Text>
          <TextInput
            accessibilityLabel="Loan interest rate"
            style={s.input}
            value={interestRate}
            onChangeText={setInterestRate}
            keyboardType="decimal-pad"
            editable={!busy}
          />
          <DateField
            label="Loan start date"
            value={startDate}
            onChangeText={setStartDate}
            disabled={busy}
          />
          <DateField
            label="Loan due date"
            value={dueDate}
            onChangeText={setDueDate}
            disabled={busy}
            minDate={startDate || undefined}
          />
          <View style={s.actions}>
            {button('Save approved loan record', createLoan)}
            {button('Cancel loan setup', () => setApplication(null))}
          </View>
        </View>
      )}
      {disbursement && (
        <View style={s.card}>
          <Text style={s.title}>Record disbursement for {disbursement.loanReference}?</Text>
          <Text style={s.detail}>
            {disbursement.currency ?? 'SLE'} {disbursement.principalAmount}. Confirm after the
            approved funds have been released.
          </Text>
          <View style={s.actions}>
            {button(
              'Confirm loan disbursement',
              () => void submit(`/loans/${disbursement.id}/disburse`, {}),
            )}
            {button('Cancel disbursement', () => setDisbursement(null))}
          </View>
        </View>
      )}
      {!loading && data?.items.length === 0 && (
        <Text style={s.detail}>No financial operations found.</Text>
      )}
      {data?.items.map((row) => (
        <View key={row.id} style={s.card}>
          <Text style={s.title}>
            {row.reference ??
              row.loanReference ??
              `${row.groupMember?.user.firstName ?? ''} ${row.groupMember?.user.lastName ?? ''}`}
          </Text>
          <Text style={s.detail}>
            {row.status} · {row.savingsAccount?.currency ?? row.currency ?? 'SLE'}{' '}
            {row.amount ?? row.requestedAmount ?? row.principalAmount}
          </Text>
          {!!row.savingsAccount && (
            <Text style={s.detail}>
              {row.savingsAccount.groupMember.user.firstName}{' '}
              {row.savingsAccount.groupMember.user.lastName} · {row.savingsAccount.accountNumber}
            </Text>
          )}
          {!!(row.purpose ?? row.reason) && (
            <Text style={s.detail}>{row.purpose ?? row.reason}</Text>
          )}
          {row.financeReview && (
            <Text style={s.detail}>
              Financial review: {row.financeReview.newValues.decision?.replaceAll('_', ' ')} ·{' '}
              {row.financeReview.newValues.notes}
              {'\n'}
              {row.financeReview.user?.firstName} {row.financeReview.user?.lastName} ·{' '}
              {new Date(row.financeReview.createdAt).toLocaleString()}
            </Text>
          )}
          {row.reviewNotes && <Text style={s.detail}>Admin review: {row.reviewNotes}</Text>}
          {queue === 'Withdrawals' &&
            row.status === 'PENDING' &&
            button('Review withdrawal', () => {
              setReview(row);
              setNotes('');
              setDecision('RECOMMEND_APPROVAL');
              setApplication(null);
              setDisbursement(null);
              setError('');
              setNotice('');
            })}
          {queue === 'Approved applications' &&
            row.status === 'APPROVED' &&
            !row.loan &&
            button('Set up approved loan', () => {
              setApplication(row);
              setInterestRate('0');
              setStartDate('');
              setDueDate('');
              setReview(null);
              setDisbursement(null);
              setError('');
              setNotice('');
            })}
          {queue === 'Approved applications' && row.loan && (
            <Text style={s.detail}>
              Loan record already created. Open Loan operations to process it.
            </Text>
          )}
          {queue === 'Loan operations' &&
            row.status === 'APPROVED' &&
            button('Record loan disbursement', () => {
              setDisbursement(row);
              setReview(null);
              setApplication(null);
              setError('');
              setNotice('');
            })}
          {queue === 'Loan operations' && row.outstandingBalance !== undefined && (
            <Text style={s.detail}>
              Outstanding: {row.currency ?? 'SLE'} {row.outstandingBalance}
            </Text>
          )}
        </View>
      ))}
      {data && (
        <>
          <Text style={s.detail}>
            Page {data.page} · {data.total} records
          </Text>
          <View style={s.actions}>
            {button(
              'Previous operations',
              () => setPage((value) => value - 1),
              loading || page <= 1,
            )}
            {button(
              'Next operations',
              () => setPage((value) => value + 1),
              loading || page * data.limit >= data.total,
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: {
    padding: 24,
    paddingTop: 48,
    paddingBottom: 60,
    gap: 12,
    maxWidth: 1000,
    width: '100%',
    alignSelf: 'center',
  },
  heading: { fontSize: 28, fontWeight: '700', color: '#12382E' },
  title: { fontSize: 19, fontWeight: '600', color: '#12382E' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    padding: 12,
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: '#E0F2EC',
    marginVertical: 3,
  },
  buttonText: { color: '#075C47', fontWeight: '600' },
  disabled: { opacity: 0.45 },
  detail: { color: '#466157', lineHeight: 22 },
  card: {
    padding: 18,
    gap: 10,
    borderWidth: 1,
    borderColor: '#D3E2DC',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  input: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#9BB5AA',
    borderRadius: 8,
    minHeight: 46,
    color: '#12382E',
    backgroundColor: '#FFFFFF',
  },
  error: { color: '#B42318', padding: 10 },
  success: { color: '#087443', padding: 10 },
});
