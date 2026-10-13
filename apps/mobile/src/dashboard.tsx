import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';

type IconName =
  | 'plant'
  | 'bell'
  | 'coins'
  | 'plus'
  | 'arrow'
  | 'history'
  | 'people'
  | 'home'
  | 'loan'
  | 'down'
  | 'up'
  | 'chevron'
  | 'back'
  | 'sprout'
  | 'calendar'
  | 'card';
export function DashboardIcon({
  name,
  color = '#006B4E',
  size = 28,
}: {
  name: IconName;
  color?: string;
  size?: number;
}) {
  const paths: Partial<Record<IconName, string>> = {
    back: 'M20 12H4m7-7-7 7 7 7',
    sprout: 'M12 21v-9M12 14C5 14 3 9 3 5c7 0 9 4 9 9m0-3c0-7 4-9 9-9 0 7-4 11-9 11',
    calendar:
      'M5 5h14a2 2 0 0 1 2 2v13H3V7a2 2 0 0 1 2-2M7 2v6M17 2v6M3 10h18M7 14h1m4 0h1m4 0h1M7 17h1m4 0h1',
    card: 'M4 4h16a1 1 0 0 1 1 1v15H3V5a1 1 0 0 1 1-1M3 9h18M16 14h2m-2 3h2',
    bell: 'M6 17h12l-2-3V9a4 4 0 0 0-8 0v5l-2 3m4 3a2 2 0 0 0 4 0M12 3v2',
    plus: 'M12 5v14M5 12h14',
    arrow: 'M6 18 18 6M7 6h11v11',
    history: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6',
    home: 'm3 11 9-8 9 8M5 10v11h5v-7h4v7h5V10',
    loan: 'M3 18h4l4 3 9-7-2-2-6 4H8m-5-2h5l3 2M14 4v6m2-5h-3a1 1 0 0 0 0 2h2a1 1 0 0 1 0 2h-3',
    down: 'M12 4v16m-6-6 6 6 6-6',
    up: 'M12 20V4m-6 6 6-6 6 6',
    chevron: 'm9 5 7 7-7 7',
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false} aria-hidden>
      {name === 'plant' ? (
        <>
          <Circle cx="12" cy="5" r="3.2" fill="#00744D" />
          <Circle cx="7" cy="8" r="1.8" fill="#F4CF2D" />
          <Circle cx="17" cy="8" r="1.8" fill="#F4CF2D" />
          <Path
            d="M12 22C2 22 1 15 2 9c7 2 10 5 10 13M12 22c10 0 11-7 10-13-7 2-10 5-10 13"
            fill="#00744D"
          />
          <Path d="M5 13 10 20M19 13 14 20" stroke="#55AB65" strokeWidth="1.2" />
          <Path d="m12 10 2 3-2 3-2-3z" fill="#F4CF2D" />
        </>
      ) : name === 'sprout' ? (
        <>
          <Path d="M12 21V12" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
          <Path
            d="M12 14C5 14 3 9 3 5c7 0 9 4 9 9M12 12c0-7 4-10 10-10 0 7-4 11-10 10"
            fill={color}
          />
          <Path d="m6 8 6 6m5-8-5 6" stroke="#00764D" strokeWidth="1" fill="none" />
        </>
      ) : name === 'coins' ? (
        <>
          <Path
            d="M3 12v7c0 3 11 3 11 0v-7m-11 3c0 3 11 3 11 0m-11 3c0 3 11 3 11 0M12 6v3m0 0c0 3 9 3 9 0m-5 5c3 0 5-1 5-2V6m-5 11c3 0 5-1 5-2"
            stroke={color}
            strokeWidth="1.8"
            fill="none"
          />
          <Ellipse cx="8.5" cy="12" rx="5.5" ry="2.5" fill={color} />
          <Ellipse cx="16.5" cy="5.5" rx="4.5" ry="2.5" fill={color} />
        </>
      ) : name === 'people' ? (
        <>
          <Circle cx="12" cy="7" r="3.5" fill={color} />
          <Circle cx="5" cy="9" r="2.5" fill={color} />
          <Circle cx="19" cy="9" r="2.5" fill={color} />
          <Path
            d="M7 21v-5a5 5 0 0 1 10 0v5zM1 19v-4a4 4 0 0 1 5-4v8zm17 0v-8a4 4 0 0 1 5 4v4z"
            fill={color}
          />
        </>
      ) : (
        <Path
          d={paths[name]}
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={name === 'home' ? color : 'none'}
        />
      )}
    </Svg>
  );
}

export function formatSle(value: number | string) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `SLE ${amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : 'Unavailable';
}

export function dashboardGroupName(name: string) {
  return /^module\s*6\s+validation\s+group(?:\s+\d+)?$/i.test(name.trim())
    ? 'Sierra Leone Mile 91 MicroFinance Group'
    : name;
}

type Action = { label: string; onPress: () => void };
type Activity = {
  id: string;
  title: string;
  date?: string;
  detail?: string;
  amount?: number | string;
  outgoing?: boolean;
};
type Props = {
  memberId?: string;
  unreadNotifications?: number;
  onPayContribution?: () => void;
  onRepayLoan?: () => void;
  onApplyLoan?: () => void;
  onReviewRequests?: () => void;
  role: string;
  totalSavings?: number | string;
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  onLogout: () => void;
  onNotifications?: () => void;
  onSavings?: () => void;
  onLoans?: () => void;
  onHistory?: () => void;
  onAddMember?: () => void;
  onBlockchain?: () => void;
  blockchainVerified?: boolean;
  community?: { name: string; members?: number; onPress: () => void };
  activities: Activity[];
  actions: Action[];
  children?: ReactNode;
};

export function Dashboard(props: Props) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning,' : hour < 18 ? 'Good afternoon,' : 'Good evening,';
  const role = props.role
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const quick = [
    { label: 'Save', icon: 'plus' as const, press: props.onSavings, dark: true },
    { label: 'Pay loan', icon: 'arrow' as const, press: props.onLoans },
    { label: 'History', icon: 'history' as const, press: props.onHistory },
  ].filter((action) => action.press);
  const nav = [
    { label: 'Home', icon: 'home' as const, press: () => {}, active: true },
    { label: 'Savings', icon: 'coins' as const, press: props.onSavings },
    { label: 'Loans', icon: 'loan' as const, press: props.onLoans },
    { label: 'Activity', icon: 'history' as const, press: props.onHistory },
  ].filter((item) => item.press);
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
          <DashboardIcon name="plant" size={48} />
          <View style={s.greeting}>
            <Text style={s.muted}>{greeting}</Text>
            <Text style={s.role}>{role}</Text>
            {props.memberId && <Text style={s.muted}>ID: {props.memberId}</Text>}
          </View>
          {props.onNotifications && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              onPress={props.onNotifications}
              style={s.bell}
            >
              <DashboardIcon name="bell" color="#0B1026" size={28} />
              {Boolean(props.unreadNotifications) && <Text style={s.badge}>{props.unreadNotifications! > 99 ? '99+' : props.unreadNotifications}</Text>}
            </Pressable>
          )}
        </View>
        <View style={s.headingRow}>
          <Text accessibilityRole="header" aria-level={1} style={s.heading}>
            My Dashboard
          </Text>
          {props.onBlockchain && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Blockchain"
              onPress={props.onBlockchain}
              style={s.sync}
            >
              <View style={s.syncTitle}>
                <View style={[s.dot, props.blockchainVerified && s.verifiedDot]} />
                <Text style={s.syncText}>
                  {props.blockchainVerified ? 'Blockchain verified' : 'Blockchain'}
                </Text>
              </View>
              <Text style={s.syncDetail}>
                {props.blockchainVerified ? 'Verified record' : 'Check status'}
              </Text>
            </Pressable>
          )}
        </View>
        {props.loading ? (
          <ActivityIndicator
            accessibilityLabel="Loading dashboard"
            color="#006B4E"
            size="large"
            style={s.loading}
          />
        ) : props.error ? (
          <View accessibilityRole="alert" style={s.error}>
            <Text style={s.body}>{props.error}</Text>
            <Pressable accessibilityRole="button" onPress={props.onRefresh} style={s.retry}>
              <Text style={s.link}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Total savings"
            disabled={!props.onSavings}
            onPress={props.onSavings}
            style={s.balance}
          >
            <View style={s.coinBadge}>
              <DashboardIcon name="coins" color="#FFE044" size={42} />
            </View>
            <View style={s.balanceContent}>
              <Text style={s.balanceLabel}>Total savings</Text>
              <Text style={s.balanceValue}>
                {props.totalSavings === undefined ? 'Unavailable' : formatSle(props.totalSavings)}
              </Text>
            </View>
            {props.onSavings && <DashboardIcon name="chevron" color="#FFFFFF" size={24} />}
          </Pressable>
        )}
        <View style={s.quickRow}>
          {quick.map((action) => (
            <Pressable
              key={action.label}
              accessibilityRole="button"
              onPress={action.press}
              style={s.quickCard}
            >
              <View style={[s.quickIcon, action.dark && s.darkIcon]}>
                <DashboardIcon
                  name={action.icon}
                  color={action.dark ? '#FFFFFF' : '#006B4E'}
                  size={30}
                />
              </View>
              <Text style={s.quickLabel}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
        {props.onAddMember && (
          <Pressable accessibilityRole="button" onPress={props.onAddMember} style={s.addMember}>
            <DashboardIcon name="people" size={26} />
            <Text style={s.link}>Add member</Text>
            <DashboardIcon name="plus" size={22} />
          </Pressable>
        )}
        <View style={s.services}>
          {[
            { label: 'Pay contribution', press: props.onPayContribution },
            { label: 'Apply for a loan', press: props.onApplyLoan },
            { label: 'Repay loan', press: props.onRepayLoan },
            { label: 'Confirm member requests', press: props.onReviewRequests },
          ].filter((action) => action.press).map((action) => <Pressable key={action.label} accessibilityRole="button" style={s.service} onPress={action.press}><Text style={s.link}>{action.label}</Text></Pressable>)}
        </View>
        {props.community ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`My community, ${dashboardGroupName(props.community.name)}`}
            onPress={props.community.onPress}
            style={s.community}
          >
            <View style={s.peopleBadge}>
              <DashboardIcon name="people" color="#008C4E" size={42} />
            </View>
            <View style={s.communityContent}>
              <Text style={s.body}>My community</Text>
              <Text style={s.group}>{dashboardGroupName(props.community.name)}</Text>
              <Text style={s.muted}>
                {props.community.members === undefined
                  ? 'View group details'
                  : `${props.community.members} members`}
              </Text>
            </View>
            <DashboardIcon name="chevron" />
          </Pressable>
        ) : (
          <View style={s.community}>
            <View style={s.peopleBadge}>
              <DashboardIcon name="people" size={36} />
            </View>
            <View style={s.communityContent}>
              <Text style={s.group}>My community</Text>
              <Text style={s.muted}>
                {props.loading
                  ? 'Loading community…'
                  : props.error
                    ? 'Community unavailable'
                    : 'No group available yet'}
              </Text>
            </View>
          </View>
        )}
        <View style={s.activityPanel}>
          <View style={s.activityHeader}>
            <Text accessibilityRole="header" aria-level={2} style={s.section}>
              Recent activity
            </Text>
            {props.onHistory && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="See all activity"
                onPress={props.onHistory}
                style={s.seeAll}
              >
                <Text style={s.link}>See all</Text>
              </Pressable>
            )}
          </View>
          {props.loading ? (
            <Text style={s.muted}>Loading account activity...</Text>
          ) : props.error ? (
            <Text style={s.muted}>Account activity is unavailable.</Text>
          ) : props.activities.length === 0 ? (
            <Text style={s.empty}>No recent activity.</Text>
          ) : (
            props.activities.slice(0, 3).map((item, i) => (
              <View key={item.id} style={[s.activityRow, i > 0 && s.activityDivider]}>
                <View style={[s.activityIcon, item.outgoing && s.outgoingIcon]}>
                  <DashboardIcon
                    name={item.outgoing ? 'up' : 'down'}
                    color={item.outgoing ? '#F56519' : '#008B4C'}
                    size={28}
                  />
                </View>
                <View style={s.activityContent}>
                  <Text style={s.activityTitle}>{item.title}</Text>
                  <Text style={s.date}>
                    {item.date
                      ? new Date(item.date).toLocaleString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : item.detail}
                  </Text>
                </View>
                {item.amount !== undefined && (
                  <Text style={[s.amount, item.outgoing && s.outgoingAmount]}>
                    {item.outgoing ? '' : '+ '}
                    {formatSle(item.amount)}
                  </Text>
                )}
              </View>
            ))
          )}
        </View>
        {props.children}
        <Text accessibilityRole="header" aria-level={2} style={s.moreTitle}>
          More services
        </Text>
        <View style={s.services}>
          {props.actions.map((action) => (
            <Pressable
              accessibilityRole="button"
              key={action.label}
              onPress={action.onPress}
              style={s.service}
            >
              <Text style={s.link}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={s.utilities}>
          <Pressable
            accessibilityRole="button"
            onPress={props.onRefresh}
            disabled={props.refreshing}
            style={s.retry}
          >
            <Text style={s.link}>{props.refreshing ? 'Refreshing...' : 'Refresh'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={props.onLogout} style={s.retry}>
            <Text style={s.link}>Logout</Text>
          </Pressable>
        </View>
      </ScrollView>
      <View style={s.nav}>
        {nav.map((item) => (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            accessibilityState={{ selected: Boolean(item.active) }}
            onPress={item.press}
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
  badge: { position: 'absolute', top: 0, right: 0, backgroundColor: '#006347', color: '#FFFFFF', borderRadius: 12, paddingHorizontal: 5, minWidth: 20, textAlign: 'center', fontSize: 12, fontWeight: '700' },
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  content: {
    flexGrow: 1,
    padding: 16,
    paddingTop: 22,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    backgroundColor: '#F8FCFA',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  greeting: { flex: 1 },
  muted: { fontSize: 15, color: '#526276', lineHeight: 22 },
  role: { fontSize: 21, fontWeight: '700', color: '#0B1026', marginTop: 2 },
  bell: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  headingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
  },
  heading: { fontSize: 27, fontWeight: '800', color: '#0B1026', flexShrink: 1 },
  sync: {
    backgroundColor: '#E2F7ED',
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 8,
    minHeight: 48,
  },
  syncTitle: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#66756F' },
  verifiedDot: { backgroundColor: '#008B13' },
  syncText: { fontSize: 13, color: '#0B3024', fontWeight: '600' },
  syncDetail: { color: '#526276', fontSize: 12, marginLeft: 17, marginTop: 2 },
  balance: {
    backgroundColor: '#006347',
    borderRadius: 22,
    padding: 18,
    minHeight: 110,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 12,
  },
  coinBadge: {
    width: 60,
    height: 64,
    borderRadius: 23,
    backgroundColor: '#007C53',
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceContent: { flex: 1 },
  balanceLabel: { fontSize: 16, color: '#FFFFFF', marginBottom: 7 },
  balanceValue: { color: '#FFFFFF', fontSize: 27, fontWeight: '800' },
  quickRow: { flexDirection: 'row', gap: 9, marginBottom: 14 },
  quickCard: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#EAF7F2',
    borderRadius: 18,
    paddingVertical: 13,
    paddingHorizontal: 4,
    gap: 9,
  },
  quickIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: '#B7EDD3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  darkIcon: { backgroundColor: '#007052' },
  addMember: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    minHeight: 52,
    backgroundColor: '#EAF7F2',
    borderRadius: 16,
    marginBottom: 14,
  },
  quickLabel: { fontSize: 16, color: '#0B1026', textAlign: 'center' },
  community: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: '#EAF7F2',
    borderRadius: 20,
    marginBottom: 14,
  },
  peopleBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#D4F5E4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  communityContent: { flex: 1 },
  body: { fontSize: 16, color: '#0B1026', lineHeight: 23 },
  group: { fontSize: 19, fontWeight: '700', color: '#0B1026', marginVertical: 3 },
  activityPanel: { borderRadius: 20, padding: 15, backgroundColor: '#FFFFFF', marginBottom: 12 },
  activityHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  section: { fontSize: 20, fontWeight: '700', color: '#0B1026' },
  seeAll: { minHeight: 44, justifyContent: 'center' },
  link: { color: '#006B4E', fontSize: 15, fontWeight: '600' },
  activityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 13,
  },
  activityDivider: { borderTopWidth: 1, borderTopColor: '#EEF2F4' },
  activityIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E0F8EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outgoingIcon: { backgroundColor: '#FFF0E7' },
  activityContent: { flexGrow: 1, flexBasis: 125 },
  activityTitle: { color: '#0B1026', fontSize: 16 },
  date: { color: '#617086', fontSize: 13, marginTop: 5, lineHeight: 19 },
  amount: { color: '#007D43', fontSize: 16, fontWeight: '700', flexShrink: 1 },
  outgoingAmount: { color: '#CE2018' },
  empty: { fontSize: 15, color: '#526276', paddingVertical: 15 },
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
  moreTitle: { color: '#0B1026', fontSize: 18, fontWeight: '700', marginVertical: 12 },
  services: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  service: {
    minHeight: 48,
    justifyContent: 'center',
    backgroundColor: '#EAF7F2',
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  utilities: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  retry: { minHeight: 48, paddingHorizontal: 12, justifyContent: 'center' },
  error: { backgroundColor: '#FFF1ED', padding: 16, borderRadius: 16, marginBottom: 14 },
  loading: { marginVertical: 32 },
});
