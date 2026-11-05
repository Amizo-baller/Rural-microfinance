import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { request } from './api-client';

export function GroupMemberPolicy({
  groupId,
  weeklyAmount,
  withdrawalsAllowed,
}: {
  groupId: string;
  weeklyAmount?: string | null;
  withdrawalsAllowed?: boolean;
}) {
  const [amount, setAmount] = useState(weeklyAmount ?? '');
  const [allowed, setAllowed] = useState(withdrawalsAllowed ?? true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save() {
    if (busy) return;
    if (amount && !/^\d{1,12}(\.\d{1,2})?$/.test(amount)) {
      setMessage('Enter a weekly amount with up to two decimals.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await request(`/groups/${groupId}`, {
        method: 'PATCH',
        body: {
          ...(amount ? { weeklyContributionAmount: amount } : {}),
          withdrawalsAllowed: allowed,
        },
      });
      setMessage('Member contribution and withdrawal policy saved.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Policy could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 12, paddingVertical: 16 }}>
      <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '700' }}>
        Member contribution and withdrawal policy
      </Text>
      <Text>
        Weekly contribution (SLE). Leave blank to keep the current setting. Zero means no weekly
        amount is due.
      </Text>
      <Text>
        Changes apply from the Monday of this week. Earlier weeks keep their recorded rate.
      </Text>
      <TextInput
        accessibilityLabel="Weekly contribution amount"
        keyboardType="decimal-pad"
        value={amount}
        onChangeText={setAmount}
        editable={!busy}
        style={{ padding: 12, borderWidth: 1, borderColor: '#64748B', borderRadius: 8 }}
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: allowed, disabled: busy }}
        disabled={busy}
        onPress={() => setAllowed(!allowed)}
      >
        <Text>{allowed ? '☑' : '☐'} Permit member withdrawal requests</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void save()}
        style={{ padding: 12, backgroundColor: '#2158B0', borderRadius: 8 }}
      >
        <Text style={{ color: 'white' }}>{busy ? 'Saving policy…' : 'Save member policy'}</Text>
      </Pressable>
      {!!message && <Text accessibilityRole="alert">{message}</Text>}
    </View>
  );
}
