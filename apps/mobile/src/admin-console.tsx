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
import { RoleDropdown } from './role-dropdown';
import { ACCOUNT_ROLES, roleLabel } from './account-roles';

type Person = { id: string; firstName: string; lastName: string; email?: string; phone?: string };
type Row = {
  id: string;
  status?: string;
  firstName?: string;
  profileImageUrl?: string;
  groupId?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  name?: string;
  registrationNo?: string;
  location?: string;
  contactInfo?: string;
  description?: string;
  manager?: Person;
  user?: Person;
  group?: { name: string };
  role?: { name: string };
  memberNumber?: string;
  reference?: string;
  amount?: string;
  reason?: string;
  reviewNotes?: string;
  payoutDestination?: { accountNumber?: string; providerId?: string };
  payoutFees?: string;
  payoutReference?: string;
  financeReview?: {
    newValues: { decision?: string; notes?: string };
    createdAt: string;
    user: { firstName: string; lastName: string } | null;
  } | null;
  savingsAccount?: { accountNumber: string; currency: string };
  requesterId?: string;
  startDate?: string;
  endDate?: string;
  targetAmount?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  createdAt?: string;
  oldValues?: unknown;
  newValues?: unknown;
  transactionHash?: string;
  transactionId?: string;
  network?: string;
  blockNumber?: string;
  errorMessage?: string;
  accountNumber?: string;
  currency?: string;
  balance?: string;
  groupMember?: { user: { firstName: string; lastName: string }; group: { name: string } };
};
type Page = {
  items: Row[];
  total: number;
  page: number;
  limit: number;
  delivery?: { status: string; _count: { _all: number } }[];
  pendingCount?: number;
};
const sections = [
  'Users',
  'Groups',
  'Members',
  'Savings accounts',
  'Withdrawals',
  'Savings cycles',
  'Audit logs',
  'Blockchain',
  'Announcements',
  'System settings',
] as const;
type Section = (typeof sections)[number];
const endpoints: Partial<Record<Section, string>> = {
  Users: '/users',
  Groups: '/groups',
  Members: '/members',
  'Savings accounts': '/admin/savings-accounts',
  Withdrawals: '/admin/withdrawals',
  'Savings cycles': '/admin/cycles',
  'Audit logs': '/admin/audit-logs',
  Blockchain: '/admin/blockchain',
};
const roles = ACCOUNT_ROLES.map((role) => role.value);
type Form = {
  title: string;
  path: string;
  method: string;
  values: Record<string, string>;
  fields: string[];
  choices?: Record<string, string[]>;
};
const labels: Record<string, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  registrationNo: 'Registration number',
  contactInfo: 'Contact information',
  managerId: 'Group administrator',
  userId: 'User',
  groupId: 'Community group',
  savingsAccountId: 'Savings account',
  startDate: 'Start date',
  endDate: 'End date',
  targetAmount: 'Savings target (SLE)',
  amount: 'Amount (SLE)',
  value: 'Value (JSON object)',
};
function label(key: string) {
  return labels[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}
function title(row: Row) {
  return (
    row.action ??
    row.name ??
    (row.firstName
      ? `${row.firstName} ${row.lastName}`
      : row.user
        ? `${row.user.firstName} ${row.user.lastName}`
        : (row.accountNumber ?? row.reference ?? row.action ?? row.transactionHash ?? row.id))
  );
}

export function AdminConsole({
  userId,
  onBack,
  onLoans,
  onContributions,
  onReports,
}: {
  userId: string;
  onBack: () => void;
  onLoans: () => void;
  onContributions: () => void;
  onReports: () => void;
}) {
  const [section, setSection] = useState<Section>('Users');
  const [data, setData] = useState<Page | null>(null);
  const [pendingWithdrawalCount, setPendingWithdrawalCount] = useState(0);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [confirmation, setConfirmation] = useState<{
    text: string;
    path: string;
    method: string;
    body: object;
  } | null>(null);
  const [groups, setGroups] = useState<Row[]>([]);
  const [users, setUsers] = useState<Row[]>([]);
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [accountSearch, setAccountSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [choicesLoading, setChoicesLoading] = useState(false);
  const [choiceError, setChoiceError] = useState('');
  const sequence = useRef(0);
  const choiceSequence = useRef(0);
  const [settings, setSettings] = useState<{ id: string; key: string; value: object }[]>([]);
  const [verification, setVerification] = useState('');

  useEffect(() => {
    void request<Page>('/admin/withdrawals?page=1&limit=1')
      .then((result) => setPendingWithdrawalCount(result.pendingCount ?? 0))
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    const ticket = ++sequence.current;
    setLoading(true);
    setError('');
    setData(null);
    setSettings([]);
    try {
      if (section === 'System settings') {
        const result = await request<typeof settings>('/system/settings');
        if (ticket === sequence.current) setSettings(result);
      } else if (endpoints[section]) {
        const searchable = [
          'Users',
          'Groups',
          'Members',
          'Savings accounts',
          'Audit logs',
          'Blockchain',
        ].includes(section);
        const result = await request<Page>(
          `${endpoints[section]}?page=${page}&limit=25${searchable && appliedSearch ? `&search=${encodeURIComponent(appliedSearch)}` : ''}`,
        );
        if (ticket === sequence.current) setData(result);
      }
    } catch (err) {
      if (ticket === sequence.current)
        setError(err instanceof Error ? err.message : 'Could not load records');
    } finally {
      if (ticket === sequence.current) setLoading(false);
    }
  }, [section, page, appliedSearch]);
  useEffect(() => {
    void load();
    return () => {
      sequence.current++;
    };
  }, [load]);

  const loadChoices = useCallback(async (groupTerm = '', userTerm = '', accountTerm = '') => {
    const ticket = ++choiceSequence.current;
    setChoicesLoading(true);
    setChoiceError('');
    const results = await Promise.allSettled([
      request<Page>(`/groups?limit=100&search=${encodeURIComponent(groupTerm)}`),
      request<Page>(`/users?limit=100&search=${encodeURIComponent(userTerm)}`),
      request<Page>(`/admin/savings-accounts?limit=100&search=${encodeURIComponent(accountTerm)}`),
    ]);
    if (ticket !== choiceSequence.current) return;
    if (results[0].status === 'fulfilled') setGroups(results[0].value.items);
    if (results[1].status === 'fulfilled') setUsers(results[1].value.items);
    if (results[2].status === 'fulfilled') setAccounts(results[2].value.items);
    if (results.some((r) => r.status === 'rejected'))
      setChoiceError('Could not load all choices. Search again to retry.');
    setChoicesLoading(false);
  }, []);
  useEffect(() => {
    void loadChoices();
    return () => {
      choiceSequence.current++;
    };
  }, [loadChoices]);

  function changeSection(next: Section) {
    sequence.current++;
    setSection(next);
    setPage(1);
    setSearch('');
    setAppliedSearch('');
    setForm(null);
    setConfirmation(null);
    setNotice('');
    setError('');
    setVerification('');
  }
  async function mutate(path: string, method: string, body: object) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request(path, { method, body });
      setForm(null);
      setConfirmation(null);
      setNotice('Saved successfully.');
      await load();
      if (['Users', 'Groups', 'Members'].includes(section))
        void loadChoices(groupSearch, userSearch);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The action could not be completed');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function openForm(next: Form) {
    setForm(next);
    setConfirmation(null);
    setError('');
    setNotice('');
  }
  function confirm(text: string, path: string, body: object, method = 'PATCH') {
    setConfirmation({ text, path, body, method });
    setForm(null);
    setError('');
    setNotice('');
  }
  function create() {
    if (section === 'Users')
      openForm({
        title: 'Create user',
        path: '/users',
        method: 'POST',
        fields: ['firstName', 'lastName', 'email', 'phone', 'password', 'role'],
        values: { role: 'MEMBER' },
        choices: { role: roles },
      });
    if (section === 'Groups')
      openForm({
        title: 'Create community group',
        path: '/groups',
        method: 'POST',
        fields: ['name', 'registrationNo', 'location', 'contactInfo', 'description', 'managerId'],
        values: { managerId: userId },
      });
    if (section === 'Members')
      openForm({
        title: 'Approve and add member',
        path: '/members',
        method: 'POST',
        fields: ['userId', 'groupId'],
        values: {},
      });
    if (section === 'Withdrawals')
      openForm({
        title: 'Record withdrawal request',
        path: '/admin/withdrawals',
        method: 'POST',
        fields: ['savingsAccountId', 'amount', 'providerId', 'payoutPhone', 'reference', 'reason'],
        values: { reference: `WD-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
      });
    if (section === 'Savings cycles')
      openForm({
        title: 'Plan savings cycle',
        path: '/admin/cycles',
        method: 'POST',
        fields: ['groupId', 'name', 'startDate', 'endDate', 'targetAmount'],
        values: {},
      });
    if (section === 'Announcements')
      openForm({
        title: 'Make announcement',
        path: '/notifications/announcements',
        method: 'POST',
        fields: ['groupId', 'title', 'message'],
        values: {},
      });
    if (section === 'System settings')
      openForm({
        title: 'Create system setting',
        path: '/system/settings/',
        method: 'PATCH',
        fields: ['key', 'value'],
        values: { value: '{}' },
      });
  }
  async function save() {
    if (!form) return;
    const values = Object.fromEntries(
      Object.entries(form.values)
        .filter(([, value]) => value.trim() !== '')
        .map(([key, value]) => [key, value.trim()]),
    );
    let path = form.path;
    const body: Record<string, unknown> = { ...values };
    if (form.fields.includes('value')) {
      try {
        const value: unknown = JSON.parse(values.value ?? '');
        if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
        body.value = value;
        if (form.fields.includes('key')) {
          if (!/^[A-Za-z0-9_.-]{2,100}$/.test(values.key ?? '')) {
            setError(
              'Enter a setting key of 2–100 letters, numbers, dots, underscores or hyphens.',
            );
            return;
          }
          path += encodeURIComponent(values.key);
          delete body.key;
        }
      } catch {
        setError('Enter a valid JSON object for the setting value.');
        return;
      }
    }
    await mutate(path, form.method, body);
  }
  function edit(row: Row) {
    const fields =
      section === 'Users'
        ? ['firstName', 'lastName', 'email', 'phone', 'profileImageUrl']
        : ['name', 'registrationNo', 'location', 'contactInfo', 'description', 'managerId'];
    openForm({
      title: `Edit ${title(row)}`,
      path: `${endpoints[section]}/${row.id}`,
      method: 'PATCH',
      fields,
      values: Object.fromEntries(
        fields.map((key) => [
          key,
          key === 'managerId' ? (row.manager?.id ?? '') : String(row[key as keyof Row] ?? ''),
        ]),
      ),
    });
  }
  function review(row: Row, decision: 'APPROVED' | 'REJECTED') {
    openForm({
      title: `${decision === 'APPROVED' ? 'Approve' : 'Reject'} withdrawal ${row.reference}`,
      path: `/admin/withdrawals/${row.id}/review`,
      method: 'POST',
      fields: decision === 'REJECTED' ? ['notes'] : [],
      values: { decision },
    });
  }
  async function verify(row: Row) {
    if (!row.transactionId || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setVerification('');
    try {
      setVerification(
        JSON.stringify(await request(`/blockchain/verify/${row.transactionId}`), null, 2),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const button = (text: string, action: () => void, disabled = false) => (
    <Pressable
      key={text}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={action}
      style={[s.button, (disabled || busy) && s.disabled]}
    >
      <Text style={s.buttonText}>{text}</Text>
    </Pressable>
  );
  const searchable = [
    'Users',
    'Groups',
    'Members',
    'Savings accounts',
    'Audit logs',
    'Blockchain',
  ].includes(section);
  return (
    <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={s.heading}>
        Admin management
      </Text>
      {button('Back to dashboard', onBack)}
      <View style={s.actions}>
        {button('Review contributions', onContributions)}
        {button('Loan applications', onLoans)}
        {button('Generate reports', onReports)}
        {button(`Pending Withdrawals (${pendingWithdrawalCount})`, () => changeSection('Withdrawals'))}
      </View>
      <View style={s.actions}>
        {sections.map((name) =>
          button(name === section ? `● ${name}` : name, () => changeSection(name)),
        )}
      </View>
      <Text accessibilityRole="header" style={s.title}>
        {section === 'Withdrawals' ? `Pending Withdrawals (${data?.pendingCount ?? 0})` : section}
      </Text>
      {searchable && (
        <View>
          <TextInput
            accessibilityLabel={`Search ${section.toLowerCase()}`}
            placeholder={section === 'Blockchain' ? 'Search transaction hash' : 'Search records'}
            value={search}
            onChangeText={setSearch}
            style={s.input}
            onSubmitEditing={() => {
              setPage(1);
              setAppliedSearch(search.trim());
            }}
          />
          {button('Search', () => {
            setPage(1);
            setAppliedSearch(search.trim());
          })}
        </View>
      )}
      <View style={s.actions}>
        {button('Refresh', () => void load(), loading)}
        {!['Audit logs', 'Blockchain', 'Savings accounts'].includes(section) &&
          button(
            section === 'Announcements'
              ? 'New announcement'
              : section === 'Withdrawals'
                ? 'New withdrawal request'
                : section === 'Members'
                  ? 'Approve / add member'
                  : 'Create new',
            create,
          )}
      </View>
      {section === 'Withdrawals' && (
        <Text style={s.detail}>
          Approval starts a Monime mobile money payout. Savings are reserved at submission; rejection requires a reason and releases the reservation.
        </Text>
      )}
      {section === 'Savings cycles' && (
        <Text style={s.detail}>
          Plan a group savings period and target. Activate, complete or cancel it. Each group can
          have one active cycle.
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
      {loading && <ActivityIndicator accessibilityLabel="Loading admin records" />}
      {busy && <ActivityIndicator accessibilityLabel="Saving admin action" />}
      {confirmation && (
        <View style={s.card}>
          <Text style={s.title}>{confirmation.text}</Text>
          <View style={s.actions}>
            {button(
              'Confirm action',
              () => void mutate(confirmation.path, confirmation.method, confirmation.body),
            )}
            {button('Cancel action', () => setConfirmation(null))}
          </View>
        </View>
      )}
      {form && (
        <View style={s.card}>
          <Text accessibilityRole="header" style={s.title}>
            {form.title}
          </Text>
          {form.fields.map((key) => {
            const options =
              key === 'savingsAccountId'
                ? accounts
                    .filter((a) => a.status === 'ACTIVE')
                    .map((a) => ({
                      id: a.id,
                      name: `${a.accountNumber} · ${a.groupMember?.user.firstName ?? ''} ${a.groupMember?.user.lastName ?? ''} · ${a.currency} ${a.balance}`,
                    }))
                : key === 'groupId'
                  ? groups
                      .filter((g) => g.status === 'ACTIVE')
                      .map((g) => ({ id: g.id, name: title(g) }))
                  : key === 'managerId'
                    ? users
                        .filter(
                          (u) =>
                            u.status === 'ACTIVE' &&
                            ['GROUP_MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(u.role?.name ?? ''),
                        )
                        .map((u) => ({ id: u.id, name: title(u) }))
                    : key === 'userId'
                      ? users
                          .filter((u) => u.status === 'ACTIVE' && u.role?.name === 'MEMBER')
                          .map((u) => ({ id: u.id, name: title(u) }))
                      : form.choices?.[key]?.map((v) => ({ id: v, name: v }));
            const update = (value: string) =>
              setForm((current) =>
                current ? { ...current, values: { ...current.values, [key]: value } } : null,
              );
            return (
              <View key={key}>
                <Text style={s.label}>{label(key)}</Text>
                {key === 'role' ? (
                  <RoleDropdown
                    value={form.values[key] ?? 'MEMBER'}
                    onChange={update}
                    disabled={busy}
                  />
                ) : options ? (
                  <>
                    {['userId', 'managerId', 'groupId', 'savingsAccountId'].includes(key) && (
                      <>
                        <TextInput
                          style={s.input}
                          accessibilityLabel={`Find ${label(key).toLowerCase()}`}
                          placeholder="Search by name or account number"
                          value={
                            key === 'savingsAccountId'
                              ? accountSearch
                              : key === 'groupId'
                                ? groupSearch
                                : userSearch
                          }
                          onChangeText={
                            key === 'savingsAccountId'
                              ? setAccountSearch
                              : key === 'groupId'
                                ? setGroupSearch
                                : setUserSearch
                          }
                        />
                        {button(
                          `Find ${label(key).toLowerCase()}`,
                          () => void loadChoices(groupSearch, userSearch, accountSearch),
                          choicesLoading,
                        )}
                        {!!choiceError && <Text style={s.error}>{choiceError}</Text>}
                      </>
                    )}
                    <ScrollView style={s.choices} nestedScrollEnabled>
                      {options.map((o) => (
                        <Pressable
                          key={o.id}
                          accessibilityRole="radio"
                          accessibilityState={{
                            checked: form.values[key] === o.id,
                            disabled: busy,
                          }}
                          disabled={busy}
                          onPress={() => update(o.id)}
                          style={s.choice}
                        >
                          <Text>
                            {form.values[key] === o.id ? '● ' : '○ '}
                            {o.name}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                    {!options.length && (
                      <Text style={s.detail}>
                        {choicesLoading
                          ? 'Loading choices…'
                          : 'No matching choices. Search by name or create a record first.'}
                      </Text>
                    )}
                    {!!form.values[key] && !options.some((o) => o.id === form.values[key]) && (
                      <Text style={s.detail}>Selected: {form.values[key]}</Text>
                    )}
                  </>
                ) : key.endsWith('Date') ? (
                  <DateField
                    label={label(key)}
                    disabled={busy}
                    value={form.values[key] ?? ''}
                    onChangeText={update}
                  />
                ) : (
                  <TextInput
                    style={s.input}
                    accessibilityLabel={label(key)}
                    value={form.values[key] ?? ''}
                    onChangeText={update}
                    editable={!busy}
                    secureTextEntry={key === 'password'}
                    autoCapitalize="none"
                    multiline={['message', 'description', 'notes', 'reason', 'value'].includes(key)}
                    keyboardType={
                      ['amount', 'targetAmount'].includes(key)
                        ? 'decimal-pad'
                        : key === 'email'
                          ? 'email-address'
                          : 'default'
                    }
                  />
                )}
              </View>
            );
          })}
          <View style={s.actions}>
            {button('Save changes', () => void save())}
            {button('Cancel editing', () => setForm(null))}
          </View>
        </View>
      )}
      {!loading && data?.items.length === 0 && <Text style={s.detail}>No records found.</Text>}
      {data?.delivery && (
        <Text style={s.detail}>
          Blockchain proof delivery:{' '}
          {data.delivery.map((d) => `${d.status}: ${d._count._all}`).join(' · ') ||
            'No proofs queued'}
        </Text>
      )}
      {!!verification && (
        <View style={s.card}>
          <Text selectable>{verification}</Text>
        </View>
      )}
      {data?.items.map((row) => (
        <View key={row.id} style={s.card}>
          <Text style={s.title} selectable>
            {title(row)}
          </Text>
          <Text style={s.detail}>
            {[
              row.status,
              row.role?.name ? roleLabel(row.role.name) : undefined,
              row.memberNumber,
              row.group?.name,
              row.email,
              row.phone,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {section === 'Groups' && (
            <Text style={s.detail}>
              {row.location} · {row.contactInfo}
              {row.manager
                ? ` · Administrator: ${row.manager.firstName} ${row.manager.lastName}`
                : ''}
            </Text>
          )}
          {section === 'Withdrawals' && (
            <Text style={s.detail}>
              {row.savingsAccount?.currency} {row.amount} · {row.savingsAccount?.accountNumber} · {row.status}
              {'\n'}
              {row.reason}
              {row.payoutDestination?.accountNumber ? `\nMobile money: ${row.payoutDestination.accountNumber}` : ''}
              {row.payoutFees ? `\nMonime fees: SLE ${row.payoutFees}` : ''}
              {row.payoutReference ? `\nProvider reference: ${row.payoutReference}` : ''}
              {row.reviewNotes ? `\nReview: ${row.reviewNotes}` : ''}
            </Text>
          )}
          {section === 'Withdrawals' && row.financeReview && (
            <Text style={s.detail}>
              Financial review: {row.financeReview.newValues.decision?.replaceAll('_', ' ')} ·{' '}
              {row.financeReview.newValues.notes}
              {'\n'}
              {row.financeReview.user?.firstName} {row.financeReview.user?.lastName} ·{' '}
              {new Date(row.financeReview.createdAt).toLocaleString()}
            </Text>
          )}
          {section === 'Savings cycles' && (
            <Text style={s.detail}>
              {row.startDate?.slice(0, 10)} to {row.endDate?.slice(0, 10)} · Target: SLE{' '}
              {row.targetAmount}
            </Text>
          )}
          {section === 'Savings accounts' && (
            <Text style={s.detail}>
              {row.groupMember?.user.firstName} {row.groupMember?.user.lastName} ·{' '}
              {row.groupMember?.group.name} · {row.currency} {row.balance}
            </Text>
          )}
          {section === 'Audit logs' && (
            <>
              <Text style={s.detail}>
                {row.createdAt && new Date(row.createdAt).toLocaleString()} ·{' '}
                {row.user ? `${row.user.firstName} ${row.user.lastName}` : 'System'} ·{' '}
                {row.entityType} · {row.entityId}
              </Text>
              <Text selectable style={s.detail}>
                Before: {JSON.stringify(row.oldValues)}
                {'\n'}After: {JSON.stringify(row.newValues)}
              </Text>
            </>
          )}
          {section === 'Blockchain' && (
            <Text selectable style={s.detail}>
              {row.network} · Block {row.blockNumber ?? 'pending'}
              {row.errorMessage ? `\n${row.errorMessage}` : ''}
            </Text>
          )}
          <View style={s.actions}>
            {['Users', 'Groups'].includes(section) &&
              button(`Edit ${section === 'Users' ? 'profile' : 'group settings'}`, () => edit(row))}
            {section === 'Savings accounts' &&
              ['ACTIVE', 'FROZEN', 'CLOSED']
                .filter((status) => status !== row.status)
                .map((status) =>
                  button(`Set account ${status.toLowerCase()}`, () =>
                    confirm(
                      `Change savings account ${title(row)} to ${status.toLowerCase()}?`,
                      `/savings/accounts/${row.id}/status`,
                      { status },
                    ),
                  ),
                )}
            {section === 'Users' && row.id !== userId && row.role?.name !== 'SUPER_ADMIN' && (
              <>
                {button('Change user role', () =>
                  openForm({
                    title: `Change role for ${title(row)}`,
                    path: `/system/users/${row.id}/role`,
                    method: 'PATCH',
                    fields: ['role'],
                    values: { role: row.role?.name ?? 'MEMBER' },
                    choices: { role: roles },
                  }),
                )}
                {row.status !== 'ACTIVE' &&
                  button(row.status === 'PENDING' ? 'Approve account' : 'Activate account', () =>
                    confirm(`Activate ${title(row)}?`, `/users/${row.id}/status`, {
                      status: 'ACTIVE',
                    }),
                  )}
                {row.status !== 'SUSPENDED' &&
                  button('Suspend account', () =>
                    confirm(
                      `Suspend ${title(row)}? Their sessions will be revoked.`,
                      `/users/${row.id}/status`,
                      { status: 'SUSPENDED' },
                    ),
                  )}
                {row.status === 'ACTIVE' &&
                  button('Deactivate account', () =>
                    confirm(`Deactivate ${title(row)}?`, `/users/${row.id}/status`, {
                      status: 'INACTIVE',
                    }),
                  )}
              </>
            )}
            {section === 'Groups' &&
              ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED']
                .filter((status) => status !== row.status)
                .map((status) =>
                  button(`Set ${status.toLowerCase()}`, () =>
                    confirm(
                      `Change ${title(row)} to ${status.toLowerCase()}?`,
                      `/groups/${row.id}/status`,
                      { status },
                    ),
                  ),
                )}
            {section === 'Members' &&
              ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'EXITED']
                .filter((status) => status !== row.status)
                .map((status) =>
                  button(
                    status === 'ACTIVE'
                      ? 'Approve / activate membership'
                      : `Set membership ${status.toLowerCase()}`,
                    () =>
                      confirm(
                        `Change membership for ${title(row)} to ${status.toLowerCase()}?`,
                        `/members/${row.id}/status`,
                        { status },
                      ),
                  ),
                )}
            {section === 'Withdrawals' &&
              row.status === 'PENDING' &&
              row.requesterId !== userId && (
                <>
                  {button('Approve withdrawal', () => review(row, 'APPROVED'))}
                  {button('Reject withdrawal', () => review(row, 'REJECTED'))}
                </>
              )}
            {section === 'Savings cycles' &&
              row.status === 'PLANNED' &&
              button('Edit planned cycle', () =>
                openForm({
                  title: `Edit ${title(row)}`,
                  path: `/admin/cycles/${row.id}`,
                  method: 'PATCH',
                  fields: ['groupId', 'name', 'startDate', 'endDate', 'targetAmount'],
                  values: {
                    groupId: row.groupId ?? '',
                    name: row.name ?? '',
                    startDate: row.startDate?.slice(0, 10) ?? '',
                    endDate: row.endDate?.slice(0, 10) ?? '',
                    targetAmount: row.targetAmount ?? '',
                  },
                }),
              )}
            {section === 'Savings cycles' && ['PLANNED', 'ACTIVE'].includes(row.status ?? '') && (
              <>
                {button(row.status === 'PLANNED' ? 'Activate cycle' : 'Complete cycle', () =>
                  confirm(`Update savings cycle ${title(row)}?`, `/admin/cycles/${row.id}/status`, {
                    status: row.status === 'PLANNED' ? 'ACTIVE' : 'COMPLETED',
                  }),
                )}
                {button('Cancel cycle', () =>
                  confirm(`Cancel savings cycle ${title(row)}?`, `/admin/cycles/${row.id}/status`, {
                    status: 'CANCELLED',
                  }),
                )}
              </>
            )}
            {section === 'Blockchain' &&
              !!row.transactionId &&
              button('Verify transaction', () => void verify(row))}
          </View>
        </View>
      ))}
      {section === 'System settings' &&
        settings.map((setting) => (
          <View style={s.card} key={setting.id}>
            <Text style={s.title}>{setting.key}</Text>
            <Text selectable>{JSON.stringify(setting.value)}</Text>
            {button(`Edit ${setting.key}`, () =>
              openForm({
                title: `Edit ${setting.key}`,
                path: `/system/settings/${encodeURIComponent(setting.key)}`,
                method: 'PATCH',
                fields: ['value'],
                values: { value: JSON.stringify(setting.value, null, 2) },
              }),
            )}
          </View>
        ))}
      {data && (
        <View>
          <Text style={s.detail}>
            Page {data.page} · {data.total} records
          </Text>
          <View style={s.actions}>
            {button('Previous page', () => setPage((p) => p - 1), page <= 1 || loading)}
            {button(
              'Next page',
              () => setPage((p) => p + 1),
              page * data.limit >= data.total || loading,
            )}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: {
    padding: 24,
    paddingTop: 48,
    paddingBottom: 60,
    maxWidth: 1100,
    width: '100%',
    alignSelf: 'center',
    gap: 12,
  },
  heading: { fontSize: 28, fontWeight: '700', color: '#12382E' },
  title: { fontSize: 19, fontWeight: '600', color: '#12382E' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    backgroundColor: '#E0F2EC',
    padding: 12,
    borderRadius: 8,
    marginVertical: 3,
    minHeight: 44,
  },
  buttonText: { color: '#075C47', fontWeight: '600' },
  disabled: { opacity: 0.45 },
  card: {
    padding: 18,
    borderWidth: 1,
    borderColor: '#D3E2DC',
    borderRadius: 12,
    gap: 10,
    backgroundColor: '#FFFFFF',
  },
  input: {
    borderWidth: 1,
    borderColor: '#9BB5AA',
    borderRadius: 8,
    padding: 12,
    minHeight: 46,
    backgroundColor: '#FFFFFF',
    color: '#12382E',
    marginVertical: 6,
  },
  detail: { color: '#466157', lineHeight: 22 },
  label: { fontWeight: '600', color: '#12382E', marginTop: 8 },
  error: { color: '#B42318', padding: 10 },
  success: { color: '#087443', padding: 10 },
  choices: { maxHeight: 180 },
  choice: { padding: 12, borderBottomWidth: 1, borderColor: '#E0EAE4' },
});
