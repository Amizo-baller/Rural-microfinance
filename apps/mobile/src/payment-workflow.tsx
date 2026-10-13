import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { request } from './api-client';
import { Alert } from './feedback';
import { formatSle } from './dashboard';

export type WorkflowSummary = { memberId: string; totalSavings: string | number; groupSavings: string | number; unread: number; pending: number; canReview: boolean; gatewayConfigured: boolean; loans: { id: string; loanReference: string; outstandingBalance: string }[] };
type Payment = { id: string; kind: string; reference: string; amount: string; status: string; currency: string; weekStart: string | null; gatewayPaidAt: string | null; submittedAt: string | null; reviewedAt: string | null; reviewNotes: string | null; checkoutUrl: string | null; user: { memberId: string; firstName: string; lastName: string }; reviewer: { firstName: string; lastName: string } | null; group: { name: string } };
type Application = { id: string; requestedAmount: string; status: string; purpose: string; termMonths: number; submittedAt: string | null; groupMember: { user: { firstName: string; lastName: string }; memberNumber: string }; reviewerNotes: string | null };
type Props = { token: string; mode: 'CONTRIBUTION' | 'REPAYMENT' | 'REVIEW'; onBack: () => void; onChanged: () => void; onApplyLoan: () => void; initialEmail?: string | null };
function monday() { const date = new Date(); date.setUTCDate(date.getUTCDate() - ((date.getUTCDay()+6)%7)); return date.toISOString().slice(0,10); }
function timestamp(value: string | null) { return value ? new Date(value).toLocaleString() : 'Pending'; }

export function PaymentWorkflow(props: Props) {
  const [summary, setSummary] = useState<WorkflowSummary | null>(null);
  const [rows, setRows] = useState<Payment[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [memberId, setMemberId] = useState('');
  const [amount, setAmount] = useState('');
  const [email, setEmail] = useState(props.initialEmail ?? '');
  const [week, setWeek] = useState(monday);
  const [loanId, setLoanId] = useState('');
  const [selected, setSelected] = useState<Payment | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const receiptView = useRef<View>(null);
  const attempt = useRef<{ details: string; id: string } | null>(null);
  const mounted = useRef(true);
  const op = useRef(false);
  async function load(nextPage = 1) {
    setLoading(true);
    try {
      const [state, payments] = await Promise.all([
        request<WorkflowSummary>('/workflow/summary', { token: props.token }),
        request<{ items: Payment[]; total: number }>(`/workflow/payments?page=${nextPage}`, { token: props.token }),
      ]);
      if (!mounted.current) return;
      setSummary(state); setMemberId((current) => current || state.memberId);
      setRows((current) => nextPage === 1 ? payments.items : [...current, ...payments.items.filter((row) => !current.some((item) => item.id === row.id))]);
      setPage(nextPage); setTotal(payments.total); setError(null);
      if (props.mode === 'REVIEW') {
        const result = await request<{ items: Application[] }>('/loans/applications?status=PENDING&limit=100', { token: props.token });
        if (mounted.current) setApplications(result.items);
      }
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'Could not load payments.'); }
    finally { if (mounted.current) setLoading(false); }
  }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);
  async function action(operation: () => Promise<void>) {
    if (op.current) return;
    op.current = true; setBusy(true);
    try { await operation(); if (mounted.current) { await load(); props.onChanged(); } }
    catch (failure) { Alert.alert('Could not complete request', failure instanceof Error ? failure.message : 'Please retry.'); }
    finally { op.current = false; if (mounted.current) setBusy(false); }
  }
  async function start() {
    if (!memberId.trim() || !/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) return Alert.alert('Check payment details', 'Enter your member ID and a positive amount with up to two decimal places.');
    if (props.mode === 'REPAYMENT' && !loanId) return Alert.alert('Select a loan', 'Choose your active loan.');
    await action(async () => {
      const details = JSON.stringify([props.mode, memberId, amount, week, loanId, email]);
      if (attempt.current?.details !== details) attempt.current = { details, id: `client-${Date.now()}-${Math.random().toString(36).slice(2,14)}` };
      const payment = await request<Payment>('/workflow/payments', { token: props.token, body: { requestId: attempt.current.id, memberId: memberId.trim(), kind: props.mode, amount, ...(props.mode === 'CONTRIBUTION' ? { weekStart: week } : { loanId }), ...(email.trim() ? { receiptEmail: email.trim() } : {}) } });
      if (!mounted.current) return;
      setSelected(payment); setReceipt(null);
      if (payment.checkoutUrl && payment.status === 'AWAITING_PAYMENT') await Linking.openURL(payment.checkoutUrl);
    });
  }
  async function verify() {
    if (!selected) return;
    await action(async () => { const updated = await request<Payment>(`/workflow/payments/${selected.id}/verify`, { token: props.token, body: {} }); if (mounted.current) setSelected(updated); });
  }
  async function pickReceipt() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert('Photo access needed', 'Allow photo access to select your payment screenshot.');
    const image = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.5 });
    if (!image.canceled && image.assets[0]?.base64) {
      const asset = image.assets[0];
      if ((asset.fileSize ?? 0) > 2000000 || asset.base64!.length > 2700000) return Alert.alert('Screenshot too large', 'Choose a PNG or JPEG under 2 MB.');
      setReceipt(`data:${asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg'};base64,${asset.base64}`);
    }
  }
  async function screenshot() {
    if (!selected?.gatewayPaidAt) return;
    await action(async () => {
      if (Platform.OS === 'web') { Alert.alert('Capture receipt', 'Take a screenshot of this verified receipt, then use Attach payment screenshot.'); return; }
      const base64 = await captureRef(receiptView, { format: 'png', result: 'base64', quality: 0.8 });
      if (base64.length > 2700000) throw new Error('Captured receipt is too large. Attach a smaller screenshot.');
      setReceipt(`data:image/png;base64,${base64}`);
      Alert.alert('Receipt captured', 'Your screenshot is attached. Submit it for treasurer or group manager confirmation.');
    });
  }
  async function submit() {
    if (!selected || !receipt) return Alert.alert('Attach a screenshot', 'Capture or attach the payment receipt before submitting.');
    await action(async () => {
      const updated = await request<Payment>(`/workflow/payments/${selected.id}/receipt`, { token: props.token, body: { receipt } });
      setSelected(updated);
      Alert.alert('Receipt submitted', 'Your payment is awaiting treasurer or group manager confirmation. Your balance updates after confirmation.');
    });
  }
  async function openRow(row: Payment) {
    setSelected(row); setNotes(''); setReceipt(null);
    if (props.mode === 'REVIEW' && row.submittedAt) {
      await action(async () => { const result = await request<{ receipt: string }>(`/workflow/payments/${row.id}/receipt`, { token: props.token }); setReceipt(result.receipt); });
    }
  }
  async function review(decision: 'CONFIRM' | 'REJECT') {
    if (!selected) return;
    await action(async () => { const result = await request<Payment>(`/workflow/payments/${selected.id}/review`, { token: props.token, body: { decision, notes } }); setSelected(result); Alert.alert('Review saved', decision === 'CONFIRM' ? 'Payment successfully confirmed. Balances updated; blockchain verification is queued.' : 'The member has been notified to correct their receipt.'); });
  }
  async function loanDecision(application: Application, status: 'APPROVED' | 'REJECTED') {
    await action(async () => { await request(`/loans/applications/${application.id}/status`, { token: props.token, method: 'PATCH', body: { status, reviewerNotes: notes, ...(status === 'REJECTED' ? { rejectionReason: notes } : {}) } }); Alert.alert('Loan review saved', status === 'APPROVED' ? 'Successfully approved. The member will be notified; blockchain verification is queued.' : 'The member has been notified of the rejection.'); });
  }
  function button(label: string, onPress: () => void, disabled = false) { return <Pressable accessibilityRole="button" disabled={busy || disabled} onPress={onPress} style={[s.button, (busy || disabled) && s.disabled]}><Text style={s.buttonText}>{label}</Text></Pressable>; }
  function field(label: string, value: string, setter: (value: string) => void, numeric = false) { return <View><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={setter} editable={!busy} keyboardType={numeric ? 'decimal-pad' : 'default'} autoCapitalize="none" autoCorrect={false} style={s.input} /></View>; }
  return <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}>
    <Text accessibilityRole="header" aria-level={1} style={s.title}>{props.mode === 'REVIEW' ? 'Confirm member requests' : props.mode === 'CONTRIBUTION' ? 'Pay contribution' : 'Repay loan'}</Text>
    {button('Back to dashboard', props.onBack)}
    {loading && <ActivityIndicator accessibilityLabel="Loading requests" color="#006B4E" />}
    {error && <View accessibilityRole="alert"><Text style={s.body}>{error}</Text>{button('Retry', () => void load())}</View>}
    {summary && <View style={s.card}><Text style={s.label}>Member ID: {summary.memberId}</Text><Text style={s.body}>Savings: {formatSle(summary.totalSavings)}</Text><Text style={s.body}>Community total: {formatSle(summary.groupSavings)}</Text></View>}
    {props.mode !== 'REVIEW' && <>
      <Text style={s.body}>Pay online, verify the payment, then submit your screenshot. Balances change after staff confirmation.</Text>
      {!summary?.gatewayConfigured && <Text accessibilityRole="alert" style={s.body}>Online checkout is awaiting the treasurer's payment-gateway configuration.</Text>}
      {field('Member ID', memberId, setMemberId)}
      {field('Amount to pay (SLE)', amount, setAmount, true)}
      {field('Email for gateway receipt', email, setEmail)}
      {props.mode === 'CONTRIBUTION' && field('Contribution week (YYYY-MM-DD)', week, setWeek)}
      {props.mode === 'REPAYMENT' && summary?.loans.map((loan) => button(`${loan.loanReference} · ${formatSle(loan.outstandingBalance)}${loanId === loan.id ? ' · Selected' : ''}`, () => setLoanId(loan.id)))}
      {button('Pay online', () => void start(), !summary?.gatewayConfigured)}
      {button('Apply for a loan', props.onApplyLoan)}
    </>}
    {selected && <View style={s.card}>
      <View ref={receiptView} collapsable={false} style={s.receipt}>
        <Text style={s.heading}>Payment receipt</Text><Text style={s.body}>Member ID: {selected.user.memberId}</Text><Text style={s.heading}>{formatSle(selected.amount)}</Text>
        <Text style={s.body}>{selected.reference}</Text><Text style={s.body}>Status: {selected.status}</Text>
        <Text style={s.body}>Gateway verified: {timestamp(selected.gatewayPaidAt)}</Text><Text style={s.body}>Submitted: {timestamp(selected.submittedAt)}</Text><Text style={s.body}>Reviewed: {timestamp(selected.reviewedAt)}</Text>
        {selected.reviewer && <Text style={s.body}>Reviewer: {selected.reviewer.firstName} {selected.reviewer.lastName}</Text>}
        {selected.reviewNotes && <Text style={s.body}>{selected.reviewNotes}</Text>}
      </View>
      {props.mode !== 'REVIEW' && selected.status === 'AWAITING_PAYMENT' && <>{selected.checkoutUrl && button('Resume online checkout', () => void Linking.openURL(selected.checkoutUrl!).catch(() => Alert.alert('Cannot open checkout', 'Please retry.')))}{button('Verify gateway payment', () => void verify())}</>}
      {props.mode !== 'REVIEW' && ['PAID','REJECTED'].includes(selected.status) && <>{button('Screenshot amount paid', () => void screenshot())}{button('Attach payment screenshot', () => void pickReceipt().catch(() => Alert.alert('Cannot open photos', 'Please retry.')))}{button('Submit receipt for confirmation', () => void submit(), !receipt)}</>}
      {receipt && <Image source={{ uri: receipt }} accessibilityLabel="Payment receipt screenshot" style={s.image} resizeMode="contain" />}
      {props.mode === 'REVIEW' && selected.status === 'SUBMITTED' && <>{field('Review notes or rejection reason', notes, setNotes)}{button('Confirm payment', () => void review('CONFIRM'))}{button('Reject receipt', () => void review('REJECT'), !notes.trim())}</>}
    </View>}
    <Text accessibilityRole="header" aria-level={2} style={s.heading}>Payment history</Text>
    {rows.map((row) => <Pressable key={row.id} accessibilityRole="button" onPress={() => void openRow(row)} style={s.card}><Text style={s.heading}>{formatSle(row.amount)} · {row.status}</Text><Text style={s.body}>Member {row.user.memberId} · {row.kind}</Text><Text style={s.body}>{row.reference}</Text><Text style={s.body}>{timestamp(row.reviewedAt ?? row.submittedAt ?? row.gatewayPaidAt)}</Text></Pressable>)}
    {rows.length < total && button('Load more payments', () => void load(page + 1))}
    {props.mode === 'REVIEW' && <><Text accessibilityRole="header" aria-level={2} style={s.heading}>Loan applications awaiting confirmation</Text>{field('Loan review notes / rejection reason', notes, setNotes)}{applications.map((application) => <View key={application.id} style={s.card}><Text style={s.heading}>{application.groupMember.user.firstName} {application.groupMember.user.lastName}</Text><Text style={s.body}>Member {application.groupMember.memberNumber} · {formatSle(application.requestedAmount)} · {application.termMonths} months</Text><Text style={s.body}>{application.purpose}</Text><Text style={s.body}>Submitted: {timestamp(application.submittedAt)}</Text>{button('Approve loan application', () => void loanDecision(application, 'APPROVED'))}{button('Reject loan application', () => void loanDecision(application, 'REJECTED'), !notes.trim())}</View>)}</>}
  </ScrollView>;
}
const s = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, gap: 12, backgroundColor: '#F5FCF8', maxWidth: 720, width: '100%', alignSelf: 'center' },
  title: { fontSize: 25, fontWeight: '800', color: '#0B1026' }, heading: { fontSize: 18, fontWeight: '700', color: '#0B1026' },
  label: { fontSize: 15, color: '#172033', fontWeight: '600', marginBottom: 6 }, body: { fontSize: 15, lineHeight: 23, color: '#334155' },
  input: { borderWidth: 1, borderColor: '#94A3B8', borderRadius: 10, padding: 12, minHeight: 48, backgroundColor: '#FFFFFF', color: '#0B1026' },
  button: { minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: '#006347', borderRadius: 12, padding: 12 }, buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', textAlign: 'center' }, disabled: { opacity: 0.5 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, gap: 10 }, receipt: { backgroundColor: '#FFFFFF', padding: 14, gap: 8 }, image: { width: '100%', height: 280 },
});
