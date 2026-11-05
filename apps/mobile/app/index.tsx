import { Dashboard, dashboardGroupName, formatSle } from '../src/dashboard';
import { LoanDashboard } from '../src/loan-dashboard';
import { MemberSpace } from '../src/member-space';
import { GroupMemberPolicy } from '../src/group-member-policy';
import { AdminConsole } from '../src/admin-console';
import { TreasurerConsole } from '../src/treasurer-console';
import { RoleDropdown, type AccountRole } from '../src/role-dropdown';
import { roleLabel } from '../src/account-roles';
import { WalletAuth, useWalletSessionGuard } from '../src/wallet-auth';
import { endWalletConnection, invalidateWalletRequest, selectWallet } from '../src/metamask';
import { googleIdToken } from '../src/google-auth';
import { GoogleSignInButton } from '../src/google-sign-in-button';
import { DateField } from '../src/date-field';
import { PaymentWorkflow, type WorkflowSummary } from '../src/payment-workflow';
import { assertPage, mergeRecords, RequestTracker } from '../src/integration-state';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  Keyboard,
  Platform,
  ActivityIndicator,
  Image,
  BackHandler,
  Pressable,
  RefreshControl,
  ScrollView as NativeScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewProps,
} from 'react-native';
import {
  dateRangeError,
  isValidDate,
  registrationErrors,
  type RegistrationFields,
} from '../src/validation';
import { Alert } from '../src/feedback';
import {
  ApiError,
  clearTokens,
  getStoredTokens,
  request as apiRequest,
  setAuthFailureHandler,
  storeTokens,
} from '../src/api-client';

type Screen =
  | 'splash'
  | 'onboarding'
  | 'login'
  | 'register'
  | 'forgot'
  | 'dashboard'
  | 'memberSpace'
  | 'profile'
  | 'groups'
  | 'groupDetail'
  | 'savings'
  | 'loans'
  | 'meetings'
  | 'notifications'
  | 'members'
  | 'addMember'
  | 'memberDetail'
  | 'transactions'
  | 'reports'
  | 'blockchain'
  | 'settings'
  | 'contributions'
  | 'loanApplication'
  | 'loanDetails'
  | 'repayments'
  | 'attendance'
  | 'payContribution'
  | 'payRepayment'
  | 'reviewRequests'
  | 'adminManagement'
  | 'treasurerManagement';
type Session = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; memberId: string; email: string | null; phone: string | null; role: string; walletAddress?: string };
};
type Profile = {
  id: string;
  memberId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  profileImageUrl: string | null;
  blockchainAddress?: string | null;
  status: string;
  role: { name: string };
};
type Group = {
  weeklyContributionAmount?: string | null;
  withdrawalsAllowed?: boolean;
  id: string;
  name: string;
  registrationNo: string | null;
  description: string | null;
  location: string | null;
  contactInfo: string | null;
  status: string;
  createdAt: string;
  manager: { id?: string; firstName: string; lastName: string } | null;
};
type GroupDetail = Group & {
  statistics: {
    totalMembers: number;
    activeMembers: number;
    totalSavings: number | string;
    activeLoans: number;
    outstandingLoanBalance: number | string;
    pendingLoanApplications: number;
    scheduledMeetings: number;
  };
};
type SavingsAccount = {
  id: string;
  accountNumber: string;
  balance: number | string;
  status: string;
  groupMember: {
    memberNumber: string;
    user: { firstName: string; lastName: string };
    group: { name: string };
  };
};
type Contribution = {
  id: string;
  amount: number | string;
  contributionDate: string;
  reference: string;
  paymentMethod: string;
  description: string | null;
  status: string;
};
type LoanApplication = {
  id: string;
  requestedAmount: number | string;
  purpose: string;
  termMonths: number;
  status: string;
  submittedAt: string | null;
  supportingInformation: string | null;
  reviewerNotes: string | null;
  group: { name: string };
};
type Loan = {
  id: string;
  loanReference: string;
  principalAmount: number | string;
  interestRate: number | string;
  termMonths: number;
  outstandingBalance: number | string;
  startDate: string | null;
  dueDate: string | null;
  disbursedAt: string | null;
  status: string;
};
type Repayment = {
  id: string;
  amount: number | string;
  paidAt: string;
  reference: string | null;
  status: string;
  loan: {
    loanReference: string;
    outstandingBalance: number | string;
    dueDate: string | null;
    status: string;
  };
};
type Meeting = {
  id: string;
  title: string;
  scheduledAt: string;
  location: string | null;
  agenda: string | null;
  description: string | null;
  status: string;
  group: { name: string };
  organizer: { firstName: string; lastName: string };
  attendanceStatus?: string;
};
type NotificationItem = {
  id: string;
  title: string;
  message: string;
  type: string;
  status: string;
  createdAt: string;
  readAt: string | null;
};
type Member = {
  id: string;
  memberNumber: string;
  status: string;
  joinedAt: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    status: string;
  };
  group: { id: string; name: string; registrationNo: string; location: string; status: string };
  savingsBalance?: number | string;
  loanBalance?: number | string;
};
type FinancialRecord = {
  id: string;
  type: string;
  amount: number | string;
  currency: string;
  reference: string;
  status: string;
  occurredAt: string;
  description: string | null;
  blockchainStatus: string | null;
  blockchainHash: string | null;
  group: { name: string } | null;
  groupMember: { memberNumber: string; user: { firstName: string; lastName: string } } | null;
  blockchainTransaction: { transactionHash: string; status: string; network: string | null } | null;
};
type AdminDashboardData = {
  metrics: {
    totalUsers: number;
    totalGroups: number;
    totalMembers: number;
    totalSavings: number;
    totalLoans: number;
    outstandingLoans: number;
    totalRepayments: number;
    pendingApplications: number;
    unreadNotifications: number;
  };
  charts: {
    savingsTrend: { month: string; value: number }[];
    repaymentTrend: { month: string; value: number }[];
    loanStatus: { status: string; value: number }[];
    blockchainStatus: { status: string; value: number }[];
  };
  recentTransactions: {
    id: string;
    type: string;
    amount: number;
    reference: string;
    status: string;
    occurredAt: string;
    description: string | null;
    groupName: string | null;
    member: string | null;
  }[];
  pendingApplications: {
    id: string;
    status: string;
    requestedAmount: number;
    purpose: string;
    submittedAt: string | null;
    groupName: string | null;
    member: string | null;
  }[];
  notifications: {
    id: string;
    title: string;
    message: string;
    type: string;
    status: string;
    createdAt: string;
    readAt: string | null;
  }[];
};
type ReportAnalytics = {
  filters: Record<string, string | null>;
  members: { totalMembers: number; activeMembers: number; inactiveMembers: number };
  savings: {
    totalSavings: number;
    monthlyContributions: { month: string; total: number }[];
    memberSavings: {
      memberId: string;
      memberNumber: string;
      name: string;
      groupName: string;
      savings: number;
    }[];
  };
  loans: {
    totalLoans: number;
    approvedLoans: number;
    rejectedLoans: number;
    activeLoans: number;
    completedLoans: number;
    defaultedLoans: number;
    outstandingBalance: number;
  };
  repayments: {
    totalRepayments: number;
    monthlyRepayments: { month: string; total: number }[];
    outstandingRepayments: number;
  };
  blockchain: {
    totalTransactions: number;
    verifiedTransactions: number;
    pendingTransactions: number;
    failedTransactions: number;
  };
};
type SystemSetting = { id: string; key: string; value: unknown; updatedAt: string };
type TransactionVerification = {
  transactionReference: string;
  databaseHash: string;
  blockchainHash: string | null;
  blockchainTransactionHash: string | null;
  timestamp: string | null;
  verificationResult: 'VERIFIED' | 'NOT_VERIFIED' | 'PENDING';
};
type ApiPage<T> = { items: T[]; total: number; page: number; limit: number };
type SavingsDashboard = {
  accounts: SavingsAccount[];
  totalBalance: number | string;
  contributionCount: number;
  totalContributions: number | string;
};
type SavingsStatement = { contributionCount: number; totalContributions: number | string };

async function request<T = unknown>(
  path: string,
  body?: object,
  _token?: string,
  method = body ? 'POST' : 'GET',
) {
  return apiRequest<T>(path, { body, method });
}

export default function HomeScreen() {
  const { signIn } = useLocalSearchParams<{ signIn?: string }>();
  const [screen, updateScreen] = useState<Screen>('splash');
  const screenRef = useRef<Screen>('splash');
  const setScreen = useCallback((next: Screen) => {
    if (next === 'profile' && screenRef.current !== 'profile') setProfileLoading(true);
    screenRef.current = next;
    updateScreen(next);
  }, []);
  const requestTracker = useRef(new RequestTracker());
  const paymentReferences = useRef(new Map<string, string>());
  const notificationPending = useRef(false);
  const [notificationsUpdating, setNotificationsUpdating] = useState(false);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof RegistrationFields, string>>>(
    {},
  );
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  useWalletSessionGuard(session?.user.walletAddress, logout);
  const [onboardingIndex, setOnboardingIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [role, setRole] = useState<AccountRole>('MEMBER');
  const [groupId, setGroupId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [registrationGroups, setRegistrationGroups] = useState<{ id: string; name: string; location: string | null }[]>([]);
  const [workflowSummary, setWorkflowSummary] = useState<WorkflowSummary | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<GroupDetail | null>(null);
  const [savingsSummary, setSavingsSummary] = useState<SavingsDashboard | null>(null);
  const [savingsAccounts, setSavingsAccounts] = useState<SavingsAccount[]>([]);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [savingsLoading, setSavingsLoading] = useState(false);
  const [contributionAmounts, setContributionAmounts] = useState<Record<string, string>>({});
  const [contributionMethods, setContributionMethods] = useState<Record<string, string>>({});
  const [contributionDescriptions, setContributionDescriptions] = useState<Record<string, string>>(
    {},
  );
  const [historySearch, setHistorySearch] = useState('');
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');
  const [statementTotals, setStatementTotals] = useState<
    Record<string, { count: number; total: number | string }>
  >({});
  const [loanApplications, setLoanApplications] = useState<LoanApplication[]>([]);
  const [loansLoading, setLoansLoading] = useState(false);
  const [loanAmount, setLoanAmount] = useState('');
  const [loanPurpose, setLoanPurpose] = useState('');
  const [loanDuration, setLoanDuration] = useState('');
  const [loanApplicationDate, setLoanApplicationDate] = useState('');
  const [loanSupportingInformation, setLoanSupportingInformation] = useState('');
  const [loans, setLoans] = useState<Loan[]>([]);
  const [repayments, setRepayments] = useState<Repayment[]>([]);
  const [repaymentAmounts, setRepaymentAmounts] = useState<Record<string, string>>({});
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [attendanceSubmitting, setAttendanceSubmitting] = useState<{
    meetingId: string;
    status: 'PRESENT' | 'ABSENT' | 'EXCUSED' | 'LATE';
  } | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pageInfo, setPageInfo] = useState<
    Record<string, { page: number; limit: number; total: number }>
  >({});
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [adminDashboard, setAdminDashboard] = useState<AdminDashboardData | null>(null);
  const [adminDashboardLoading, setAdminDashboardLoading] = useState(false);
  const [adminDashboardError, setAdminDashboardError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const permissionsRef = useRef(permissions);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [newMemberUserId, setNewMemberUserId] = useState('');
  const [newMemberGroupId, setNewMemberGroupId] = useState('');
  const [memberAccountSearch, setMemberAccountSearch] = useState('');
  const [memberAccounts, setMemberAccounts] = useState<Profile[]>([]);
  const [memberAccountsLoading, setMemberAccountsLoading] = useState(false);
  const [memberGroupId, setMemberGroupId] = useState('');
  const [transactions, setTransactions] = useState<FinancialRecord[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionSearch, setTransactionSearch] = useState('');
  const [transactionType, setTransactionType] = useState('');
  const [transactionStatus, setTransactionStatus] = useState('');
  const [transactionFrom, setTransactionFrom] = useState('');
  const [transactionTo, setTransactionTo] = useState('');
  const [report, setReport] = useState<ReportAnalytics | null>(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [reportGroupId, setReportGroupId] = useState('');
  const [reportMemberId, setReportMemberId] = useState('');
  const [reportTransactionType, setReportTransactionType] = useState('');
  const [reportLoanStatus, setReportLoanStatus] = useState('');
  const [blockchainStatus, setBlockchainStatus] = useState<{ configured: boolean } | null>(null);
  const [blockchainLoading, setBlockchainLoading] = useState(false);
  const [blockchainResult, setBlockchainResult] = useState<TransactionVerification | null>(null);
  const [proofResult, setProofResult] = useState<{
    transactionHash: string;
    blockNumber: number;
    verified: boolean;
  } | null>(null);
  const [transactionIdInput, setTransactionIdInput] = useState('');
  const [proofReferenceInput, setProofReferenceInput] = useState('');
  const [expectedHashInput, setExpectedHashInput] = useState('');
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingKey, setSettingKey] = useState('');
  const [settingValue, setSettingValue] = useState('');

  const onboardingSlides = [
    {
      title: 'Grow with savings',
      description: 'Track member savings, contributions, and balances with clarity and confidence.',
      accent: '#0F766E',
    },
    {
      title: 'Manage loans simply',
      description: 'Review applications, outstanding balances, and repayments from one place.',
      accent: '#0F766E',
    },
    {
      title: 'Keep everyone aligned',
      description:
        'Support meetings, attendance, notifications, and blockchain verification in one flow.',
      accent: '#2563EB',
    },
  ];

  useEffect(() => {
    void restoreSession();
  }, []);
  async function loadWorkflowSummary() {
    if (!session) return;
    const ticket = requestTracker.current.start('workflowSummary');
    try {
      const summary = await request<WorkflowSummary>('/workflow/summary', undefined, session.accessToken);
      if (requestTracker.current.current('workflowSummary', ticket)) setWorkflowSummary(summary);
    } catch { /* Preserve the last confirmed totals during a connection interruption. */ }
  }
  useEffect(() => {
    if (!session) return;
    setMemberId(session.user.memberId ?? '');
    void loadWorkflowSummary();
    let pending = false;
    const refresh = async () => {
      if (pending || screenRef.current !== 'dashboard') return;
      pending = true;
      try {
        if (['ADMIN', 'SUPER_ADMIN'].includes(session.user.role)) await loadAdminDashboard(true);
        else await loadWorkflowSummary();
      } finally { pending = false; }
    };
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, 15000);
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh(); });
    return () => { clearInterval(timer); listener.remove(); };
  }, [session?.user.id, session?.user.role, session?.accessToken]);
  useEffect(() => {
    if (screen !== 'register') return;
    let active = true;
    void request<{ id: string; name: string; location: string | null }[]>('/auth/registration-groups')
      .then((groups) => { if (active) { setRegistrationGroups(groups); if (groups.length === 1) setGroupId(groups[0].id); } })
      .catch(() => { if (active) Alert.alert('Groups unavailable', 'Check your connection or ask the group manager for your community group.'); });
    return () => { active = false; };
  }, [screen]);
  useEffect(() => {
    permissionsRef.current = permissions;
  }, [permissions]);
  useEffect(() => {
    setAuthFailureHandler(() => {
      resetLocalSession();
      Alert.alert('Session expired', 'Please sign in again.');
    });
    return () => setAuthFailureHandler(undefined);
  }, []);
  useEffect(() => {
    if (session) {
      const ticket = requestTracker.current.start('bootstrap');
      setDashboardLoading(true);
      setDashboardError(null);
      void loadProfile();
      void request<{ permissions: string[] }>('/auth/permissions', undefined, session.accessToken)
        .then(async ({ permissions: allowed }) => {
          if (!requestTracker.current.current('bootstrap', ticket)) return;
          permissionsRef.current = allowed;
          setPermissions(allowed);
          if (['ADMIN', 'SUPER_ADMIN'].includes(session.user.role)) {
            await loadAdminDashboard();
            return;
          }
          await Promise.all([
            ...(allowed.includes('groups:read') ? [loadGroups(1, false)] : []),
            ...(allowed.includes('financial:read') ? [loadSavings(1, false, false)] : []),
            ...(allowed.includes('loans:read') ? [loadLoans(1, false, false)] : []),
            ...(allowed.includes('notifications:read') ? [loadNotifications(1, false, false)] : []),
          ]);
        })
        .catch((error) => {
          if (
            !requestTracker.current.current('bootstrap', ticket) ||
            (error instanceof ApiError && error.cancelled)
          )
            return;
          setDashboardError('Account summary could not be loaded.');
          Alert.alert(
            'Dashboard unavailable',
            error instanceof Error ? error.message : 'Please try again.',
          );
        })
        .finally(() => {
          if (requestTracker.current.current('bootstrap', ticket)) setDashboardLoading(false);
        });
    }
  }, [session?.user.id]);

  useEffect(() => {
    Keyboard.dismiss();
    const title = screen.replace(/([a-z])([A-Z])/g, '$1 $2');
    if (Platform.OS === 'web') {
      document.title = title.charAt(0).toUpperCase() + title.slice(1) + ' | Rural Microfinance';
      const frame = requestAnimationFrame(() => {
        const heading = document.querySelector<HTMLElement>('[role="heading"], h1');
        if (heading) {
          heading.setAttribute('tabindex', '-1');
          heading.focus({ preventScroll: true });
        }
      });
      return () => cancelAnimationFrame(frame);
    }
    AccessibilityInfo.announceForAccessibility(title);
  }, [screen]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'dashboard' || screen === 'login' || screen === 'splash') return false;
      const parent: Partial<Record<Screen, Screen>> = {
        groupDetail: 'groups',
        memberDetail: 'members',
        contributions: 'savings',
        loanApplication: 'loans',
        loanDetails: 'loans',
        repayments: 'loans',
        attendance: 'meetings',
      };
      setScreen(parent[screen] ?? (session ? 'dashboard' : 'login'));
      return true;
    });
    return () => subscription.remove();
  }, [screen, Boolean(session)]);

  useEffect(() => {
    if (!session) return;
    if (screen === 'groups') void loadGroups();
    else if (screen === 'profile') void loadProfile();
  }, [screen, session?.user.id]);

  function updatePageInfo(key: string, result: { page: number; limit: number; total: number }) {
    setPageInfo((current) => ({
      ...current,
      [key]: { page: result.page, limit: result.limit, total: result.total },
    }));
  }

  async function loadAdminDashboard(silent = false) {
    if (!session || !['ADMIN', 'SUPER_ADMIN'].includes(session.user.role)) return;
    const ticket = requestTracker.current.start('adminDashboard');
    if (!silent) {
      setAdminDashboardLoading(true);
      setAdminDashboardError(null);
    }
    try {
      const result = await request<AdminDashboardData>(
        '/admin/dashboard',
        undefined,
        session.accessToken,
      );
      if (!requestTracker.current.current('adminDashboard', ticket)) return;
      setAdminDashboard(result);
      setAdminDashboardError(null);
    } catch (error) {
      if (
        !requestTracker.current.current('adminDashboard', ticket) ||
        (error instanceof ApiError && error.cancelled)
      )
        return;
      if (!silent) setAdminDashboardError(
        error instanceof Error ? error.message : 'Admin dashboard is unavailable.',
      );
    } finally {
      if (requestTracker.current.current('adminDashboard', ticket)) setAdminDashboardLoading(false);
    }
  }

  async function refreshScreen() {
    setRefreshing(true);
    try {
      if (screen === 'dashboard') {
        setDashboardLoading(true);
        setDashboardError(null);
        await request<{ permissions: string[] }>(
          '/auth/permissions',
          undefined,
          session?.accessToken,
        )
          .then(async ({ permissions: allowed }) => {
            permissionsRef.current = allowed;
            setPermissions(allowed);
            if (session && ['ADMIN', 'SUPER_ADMIN'].includes(session.user.role)) {
              await loadAdminDashboard();
              return;
            }
            await Promise.all([
              ...(allowed.includes('groups:read') ? [loadGroups(1, false)] : []),
              ...(allowed.includes('financial:read') ? [loadSavings(1, false, false)] : []),
              ...(allowed.includes('loans:read') ? [loadLoans(1, false, false)] : []),
              ...(allowed.includes('notifications:read')
                ? [loadNotifications(1, false, false)]
                : []),
            ]);
          })
          .catch((error) => {
            setDashboardError('Account summary could not be loaded.');
            Alert.alert(
              'Dashboard unavailable',
              error instanceof Error ? error.message : 'Please try again.',
            );
          });
      } else if (screen === 'profile') await loadProfile();
      else if (screen === 'groups') await loadGroups(1, false);
      else if (screen === 'groupDetail' && selectedGroup) await openGroup(selectedGroup);
      else if (['savings', 'contributions'].includes(screen)) await loadSavings(1, false, false);
      else if (screen === 'loanDetails' && selectedLoan && session) {
        try {
          setSelectedLoan(
            await request<Loan>(`/loans/${selectedLoan.id}`, undefined, session.accessToken),
          );
        } catch (error) {
          Alert.alert(
            'Loan unavailable',
            error instanceof Error ? error.message : 'Please try again.',
          );
        }
      } else if (['loans', 'loanApplication', 'repayments'].includes(screen))
        await loadLoans(1, false, false);
      else if (['meetings', 'attendance'].includes(screen)) await loadMeetings(1, false, false);
      else if (screen === 'notifications') await loadNotifications(1, false, false);
      else if (screen === 'members') await loadMembers(1, false, false);
      else if (screen === 'memberDetail' && selectedMember) await openMember(selectedMember);
      else if (screen === 'transactions') await loadTransactions(1, false, false);
      else if (screen === 'reports') await loadReports();
      else if (screen === 'blockchain') await loadBlockchain();
      else if (screen === 'settings') await loadSettings();
    } finally {
      if (screen === 'dashboard') setDashboardLoading(false);
      setRefreshing(false);
    }
  }

  async function loadNextPage() {
    const listScreen =
      (
        { contributions: 'savings', repayments: 'loans', attendance: 'meetings' } as Partial<
          Record<Screen, Screen>
        >
      )[screen] ?? screen;
    const key = (
      {
        groups: 'groups',
        savings: 'savings',
        loans: 'loans',
        meetings: 'meetings',
        notifications: 'notifications',
        members: 'members',
        transactions: 'transactions',
      } as const
    )[
      listScreen as
        'groups' | 'savings' | 'loans' | 'meetings' | 'notifications' | 'members' | 'transactions'
    ];
    const info = key ? pageInfo[screen === 'repayments' ? 'createdLoans' : key] : undefined;
    if (!key || !info || info.page * info.limit >= info.total || loadingMore) return;
    setLoadingMore(true);
    try {
      const nextPage = info.page + 1;
      if (key === 'groups') await loadGroups(nextPage, true);
      else if (key === 'savings') await loadSavings(nextPage, true, false);
      else if (key === 'loans') await loadLoans(nextPage, true, false);
      else if (key === 'meetings') await loadMeetings(nextPage, true, false);
      else if (key === 'notifications') await loadNotifications(nextPage, true, false);
      else if (key === 'members') await loadMembers(nextPage, true, false);
      else await loadTransactions(nextPage, true, false);
    } finally {
      setLoadingMore(false);
    }
  }

  const paginationScreen =
    (
      { contributions: 'savings', repayments: 'loans', attendance: 'meetings' } as Partial<
        Record<Screen, Screen>
      >
    )[screen] ?? screen;
  const pageKey =
    paginationScreen === 'groups' ||
    paginationScreen === 'savings' ||
    paginationScreen === 'loans' ||
    paginationScreen === 'meetings' ||
    paginationScreen === 'notifications' ||
    paginationScreen === 'members' ||
    paginationScreen === 'transactions'
      ? paginationScreen
      : undefined;
  const currentPageInfo = pageKey
    ? pageInfo[screen === 'repayments' ? 'createdLoans' : pageKey]
    : undefined;
  const canLoadMore = Boolean(
    currentPageInfo && currentPageInfo.page * currentPageInfo.limit < currentPageInfo.total,
  );
  const scrollControls = useRef({
    screen,
    refreshing,
    canLoadMore,
    loadingMore,
    refreshScreen,
    loadNextPage,
    authenticated: Boolean(session),
    permissions,
    navigate: setScreen,
    openGroups: () => {
      setScreen('groups');
      void loadGroups();
    },
    openSavings: () => {
      setScreen('savings');
      void loadSavings(1, false, false);
    },
    openLoans: () => {
      setScreen('loans');
      void loadLoans(1, false, false);
    },
  });
  scrollControls.current = {
    screen,
    refreshing,
    canLoadMore,
    loadingMore,
    refreshScreen,
    loadNextPage,
    authenticated: Boolean(session),
    permissions,
    navigate: setScreen,
    openGroups: () => {
      setScreen('groups');
      void loadGroups();
    },
    openSavings: () => {
      setScreen('savings');
      void loadSavings(1, false, false);
    },
    openLoans: () => {
      setScreen('loans');
      void loadLoans(1, false, false);
    },
  };
  const ScrollView = useCallback((props: ScrollViewProps) => {
    const controls = scrollControls.current;
    const canRefresh = !['splash', 'onboarding', 'login', 'register', 'forgot'].includes(
      controls.screen,
    );
    return (
      <NativeScrollView
        key={controls.screen}
        {...props}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          canRefresh ? (
            <RefreshControl
              refreshing={controls.refreshing}
              onRefresh={() => void scrollControls.current.refreshScreen()}
              tintColor="#0F766E"
            />
          ) : undefined
        }
      >
        {controls.authenticated && (
          <View style={styles.appNav}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: controls.screen === 'dashboard' }}
              style={[
                styles.appNavButton,
                controls.screen === 'dashboard' && styles.appNavButtonActive,
              ]}
              onPress={() => controls.navigate('dashboard')}
            >
              <Text
                style={[
                  styles.appNavText,
                  controls.screen === 'dashboard' && styles.appNavTextActive,
                ]}
              >
                Home
              </Text>
            </Pressable>
            {controls.permissions.includes('groups:read') && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  selected: controls.screen === 'groups' || controls.screen === 'groupDetail',
                }}
                style={[
                  styles.appNavButton,
                  (controls.screen === 'groups' || controls.screen === 'groupDetail') &&
                    styles.appNavButtonActive,
                ]}
                onPress={controls.openGroups}
              >
                <Text
                  style={[
                    styles.appNavText,
                    (controls.screen === 'groups' || controls.screen === 'groupDetail') &&
                      styles.appNavTextActive,
                  ]}
                >
                  Groups
                </Text>
              </Pressable>
            )}
            {controls.permissions.includes('financial:read') && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  selected: ['savings', 'contributions'].includes(controls.screen),
                }}
                style={[
                  styles.appNavButton,
                  ['savings', 'contributions'].includes(controls.screen) &&
                    styles.appNavButtonActive,
                ]}
                onPress={controls.openSavings}
              >
                <Text
                  style={[
                    styles.appNavText,
                    ['savings', 'contributions'].includes(controls.screen) &&
                      styles.appNavTextActive,
                  ]}
                >
                  Savings
                </Text>
              </Pressable>
            )}
            {controls.permissions.includes('loans:read') && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  selected: ['loans', 'loanApplication', 'loanDetails', 'repayments'].includes(
                    controls.screen,
                  ),
                }}
                style={[
                  styles.appNavButton,
                  ['loans', 'loanApplication', 'loanDetails', 'repayments'].includes(
                    controls.screen,
                  ) && styles.appNavButtonActive,
                ]}
                onPress={controls.openLoans}
              >
                <Text
                  style={[
                    styles.appNavText,
                    ['loans', 'loanApplication', 'loanDetails', 'repayments'].includes(
                      controls.screen,
                    ) && styles.appNavTextActive,
                  ]}
                >
                  Loans
                </Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: controls.screen === 'profile' }}
              style={[
                styles.appNavButton,
                controls.screen === 'profile' && styles.appNavButtonActive,
              ]}
              onPress={() => controls.navigate('profile')}
            >
              <Text
                style={[
                  styles.appNavText,
                  controls.screen === 'profile' && styles.appNavTextActive,
                ]}
              >
                Profile
              </Text>
            </Pressable>
          </View>
        )}
        {(
          [
            'contributions',
            'loanApplication',
            'loanDetails',
            'repayments',
            'attendance',
          ] as Screen[]
        ).includes(controls.screen) && (
          <Pressable
            accessibilityRole="button"
            style={styles.secondaryButton}
            onPress={() =>
              controls.navigate(
                controls.screen === 'contributions'
                  ? 'savings'
                  : controls.screen === 'attendance'
                    ? 'meetings'
                    : 'loans',
              )
            }
          >
            <Text style={styles.secondaryText}>
              Back to{' '}
              {controls.screen === 'contributions'
                ? 'savings'
                : controls.screen === 'attendance'
                  ? 'meetings'
                  : 'loans'}
            </Text>
          </Pressable>
        )}
        {canRefresh && (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: controls.refreshing }}
            disabled={controls.refreshing}
            style={styles.secondaryButton}
            onPress={() => void scrollControls.current.refreshScreen()}
          >
            <Text style={styles.secondaryText}>
              {controls.refreshing ? 'Refreshing...' : 'Refresh / Retry'}
            </Text>
          </Pressable>
        )}
        {props.children}
        {controls.canLoadMore && (
          <Pressable
            accessibilityRole="button"
            style={styles.secondaryButton}
            disabled={controls.loadingMore}
            onPress={() => void scrollControls.current.loadNextPage()}
          >
            {controls.loadingMore ? (
              <ActivityIndicator accessibilityLabel="Loading" color="#0F766E" />
            ) : (
              <Text style={styles.secondaryText}>Load more</Text>
            )}
          </Pressable>
        )}
      </NativeScrollView>
    );
  }, []);

  async function loadProfile() {
    if (!session) return;
    const ticket = requestTracker.current.start('profile');
    setProfileLoading(true);
    setProfileError(null);
    try {
      const result = await request<Profile>(
        `/users/${session.user.id}`,
        undefined,
        session.accessToken,
      );
      if (!requestTracker.current.current('profile', ticket)) return;
      setProfile(result);
    } catch (error) {
      if (
        !requestTracker.current.current('profile', ticket) ||
        (error instanceof ApiError && error.cancelled)
      )
        return;
      if (error instanceof ApiError && error.status === 401) await logout();
      else setProfileError(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      if (requestTracker.current.current('profile', ticket)) setProfileLoading(false);
    }
  }

  async function loadGroups(page = 1, append = false) {
    if (!session) return;
    if (!permissionsRef.current.includes('groups:read'))
      return Alert.alert(
        'Access unavailable',
        'Your account does not have permission to view community groups.',
      );
    const ticket = requestTracker.current.start('groups');
    setGroupsLoading(true);
    try {
      const result = await request<ApiPage<Group>>(
        `/groups?status=ACTIVE&page=${page}&limit=20`,
        undefined,
        session.accessToken,
      );
      if (!requestTracker.current.current('groups', ticket)) return;
      assertPage(result);
      setGroups((current) => (append ? mergeRecords(current, result.items) : result.items));
      updatePageInfo('groups', result);
    } catch (error) {
      if (
        !requestTracker.current.current('groups', ticket) ||
        (error instanceof ApiError && error.cancelled)
      )
        return;
      if (screenRef.current === 'dashboard')
        setDashboardError('Group totals are currently unavailable.');
      Alert.alert(
        'Groups unavailable',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      if (requestTracker.current.current('groups', ticket)) setGroupsLoading(false);
    }
  }

  async function openGroup(group: Group) {
    if (!session) return;
    const sourceScreen = screenRef.current;
    const ticket = requestTracker.current.start('groups');
    setGroupsLoading(true);
    try {
      const result = await request<GroupDetail>(
        `/groups/${group.id}`,
        undefined,
        session.accessToken,
      );
      if (!requestTracker.current.current('groups', ticket)) return;
      setSelectedGroup(result);
      if (screenRef.current === sourceScreen) setScreen('groupDetail');
    } catch (error) {
      if (
        !requestTracker.current.current('groups', ticket) ||
        (error instanceof ApiError && error.cancelled)
      )
        return;
      Alert.alert(
        'Group unavailable',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      if (requestTracker.current.current('groups', ticket)) setGroupsLoading(false);
    }
  }

  async function loadSavings(page = 1, append = false, navigate = true) {
    if (!session) return;
    const dateError = dateRangeError(historyFrom.trim(), historyTo.trim());
    if (dateError) return Alert.alert('Check dates', dateError);
    if (!permissionsRef.current.includes('financial:read'))
      return Alert.alert(
        'Access unavailable',
        'Your account does not have permission to view savings.',
      );
    if (navigate) setScreen('savings');
    const ticket = requestTracker.current.start('savings');
    setSavingsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (historySearch.trim()) params.set('search', historySearch.trim());
      if (historyFrom.trim()) params.set('from', historyFrom.trim());
      if (historyTo.trim()) params.set('to', historyTo.trim());
      const statementParams = new URLSearchParams();
      if (historyFrom.trim()) statementParams.set('from', historyFrom.trim());
      if (historyTo.trim()) statementParams.set('to', historyTo.trim());
      const dashboard = await request<SavingsDashboard>(
        '/savings/dashboard',
        undefined,
        session.accessToken,
      );
      const [history, ...statements] = await Promise.all([
        request<ApiPage<Contribution>>(
          `/savings/contributions?${params.toString()}`,
          undefined,
          session.accessToken,
        ),
        ...(dashboard.accounts ?? []).map((account: SavingsAccount) =>
          request<SavingsStatement>(
            `/savings/accounts/${account.id}/statement?${statementParams.toString()}`,
            undefined,
            session.accessToken,
          ),
        ),
      ]);
      if (!requestTracker.current.current('savings', ticket)) return;
      assertPage(history);
      setSavingsSummary(dashboard);
      setSavingsAccounts(dashboard.accounts ?? []);
      setContributions((current) =>
        append ? mergeRecords(current, history.items) : history.items,
      );
      updatePageInfo('savings', history);
      setStatementTotals(
        Object.fromEntries(
          (dashboard.accounts ?? []).map((account: SavingsAccount, index: number) => [
            account.id,
            {
              count: statements[index].contributionCount,
              total: statements[index].totalContributions,
            },
          ]),
        ),
      );
    } catch (error) {
      if (
        !requestTracker.current.current('savings', ticket) ||
        (error instanceof ApiError && error.cancelled)
      )
        return;
      if (screenRef.current === 'dashboard')
        setDashboardError('Savings totals are currently unavailable.');
      Alert.alert(
        'Savings unavailable',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      if (requestTracker.current.current('savings', ticket)) setSavingsLoading(false);
    }
  }

  function paymentReference(key: string) {
    let reference = paymentReferences.current.get(key);
    if (!reference) {
      reference = 'MOB-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
      paymentReferences.current.set(key, reference);
    }
    return reference;
  }

  async function recordContribution(account: SavingsAccount) {
    const contributionAmount = contributionAmounts[account.id] ?? '';
    const contributionDescription = contributionDescriptions[account.id] ?? '';
    const contributionMethod = contributionMethods[account.id] ?? 'MOBILE_MONEY';
    if (!permissionsRef.current.includes('financial:write'))
      return Alert.alert(
        'Access unavailable',
        'Your account does not have permission to record contributions.',
      );
    if (
      !session ||
      !/^\d+(\.\d{1,2})?$/.test(contributionAmount) ||
      Number(contributionAmount) <= 0
    )
      return Alert.alert(
        'Invalid amount',
        'Enter a positive amount with up to two decimal places.',
      );
    const paymentKey = JSON.stringify([
      'contribution',
      account.id,
      contributionAmount,
      contributionDescription,
      contributionMethod,
    ]);
    setSubmitting(true);
    try {
      await request(
        '/savings/contributions',
        {
          savingsAccountId: account.id,
          amount: contributionAmount,
          reference: paymentReference(paymentKey),
          paymentMethod: contributionMethod,
          description: contributionDescription || undefined,
        },
        session.accessToken,
      );
      paymentReferences.current.delete(paymentKey);
      setContributionAmounts((values) => ({ ...values, [account.id]: '' }));
      setContributionDescriptions((values) => ({ ...values, [account.id]: '' }));
      Alert.alert('Contribution recorded', 'Your savings balance has been updated.');
      await loadSavings(1, false, false);
    } catch (error) {
      if (error instanceof ApiError && error.cancelled) return;
      Alert.alert(
        'Contribution failed',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function loadLoans(page = 1, append = false, navigate = true) {
    if (!session) return;
    if (!permissionsRef.current.includes('loans:read'))
      return Alert.alert(
        'Access unavailable',
        'Your account does not have permission to view loan applications.',
      );
    if (navigate) setScreen('loans');
    const ticket = requestTracker.current.start('loans');
    setLoansLoading(true);
    try {
      const [result, loanResult] = await Promise.all([
        request<ApiPage<LoanApplication>>(
          `/loans/applications?page=${page}&limit=20`,
          undefined,
          session.accessToken,
        ),
        request<ApiPage<Loan>>(`/loans?page=${page}&limit=20`, undefined, session.accessToken),
      ]);
      const repaymentResults = await Promise.all(
        (loanResult.items ?? []).map((loan) =>
          request<Repayment[]>(`/loans/${loan.id}/repayments`, undefined, session.accessToken),
        ),
      );
      if (!requestTracker.current.current('loans', ticket)) return;
      assertPage(result);
      assertPage(loanResult);
      setLoanApplications((current) =>
        append ? mergeRecords(current, result.items) : result.items,
      );
      setLoans((current) => (append ? mergeRecords(current, loanResult.items) : loanResult.items));
      setRepayments((current) =>
        append ? mergeRecords(current, repaymentResults.flat()) : repaymentResults.flat(),
      );
      updatePageInfo('loanApplications', result);
      updatePageInfo('createdLoans', loanResult);
      updatePageInfo('loans', { ...result, total: Math.max(result.total, loanResult.total) });
    } catch (error) {
      if (
        !requestTracker.current.current('loans', ticket) ||
        (error instanceof ApiError && error.cancelled)
      )
        return;
      if (screenRef.current === 'dashboard')
        setDashboardError('Loan totals are currently unavailable.');
      Alert.alert(
        'Loan applications unavailable',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      if (requestTracker.current.current('loans', ticket)) setLoansLoading(false);
    }
  }

  async function submitLoanApplication() {
    if (!permissionsRef.current.includes('financial:write'))
      return Alert.alert(
        'Access unavailable',
        'Your account does not have permission to submit loan applications.',
      );
    if (!session || !/^\d+(\.\d{1,2})?$/.test(loanAmount) || Number(loanAmount) <= 0)
      return Alert.alert(
        'Invalid amount',
        'Enter a positive amount with up to two decimal places.',
      );
    if (
      loanPurpose.trim().length < 10 ||
      loanPurpose.trim().length > 2000 ||
      !/^\d+$/.test(loanDuration) ||
      Number(loanDuration) < 1 ||
      Number(loanDuration) > 120
    )
      return Alert.alert(
        'Check loan details',
        'Describe the purpose in 10 to 2000 characters and choose a duration from 1 to 120 months.',
      );
    if (loanApplicationDate.trim() && !isValidDate(loanApplicationDate.trim()))
      return Alert.alert('Invalid application date', 'Enter a real date in YYYY-MM-DD format.');
    setSubmitting(true);
    try {
      await request(
        '/loans/applications',
        {
          memberId: memberId.trim(),
          amount: loanAmount,
          purpose: loanPurpose.trim(),
          durationMonths: Number(loanDuration),
          applicationDate: loanApplicationDate.trim() || undefined,
          supportingInformation: loanSupportingInformation.trim() || undefined,
        },
        session.accessToken,
      );
      setLoanAmount('');
      setLoanPurpose('');
      setLoanDuration('');
      setLoanApplicationDate('');
      setLoanSupportingInformation('');
      Alert.alert('Application submitted', 'Your loan application is now pending review.');
      await loadLoans(1, false, false);
    } catch (error) {
      if (error instanceof ApiError && error.cancelled) return;
      Alert.alert(
        'Application failed',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRepayment(loan: Loan) {
    if (!permissionsRef.current.includes('financial:write'))
      return Alert.alert(
        'Access unavailable',
        'Your account does not have permission to record repayments.',
      );
    const amount = repaymentAmounts[loan.id] ?? '';
    if (!session || !/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0)
      return Alert.alert(
        'Invalid amount',
        'Enter a positive amount with up to two decimal places.',
      );
    if (Number(amount) > Number(loan.outstandingBalance))
      return Alert.alert(
        'Amount exceeds balance',
        'Enter an amount no greater than the outstanding balance.',
      );
    const paymentKey = JSON.stringify(['repayment', loan.id, amount]);
    setSubmitting(true);
    try {
      await request(
        `/loans/${loan.id}/repayments`,
        { amount, reference: paymentReference(paymentKey) },
        session.accessToken,
      );
      paymentReferences.current.delete(paymentKey);
      setRepaymentAmounts((values) => ({ ...values, [loan.id]: '' }));
      Alert.alert('Repayment recorded', `Your repayment for ${loan.loanReference} was recorded.`);
      await loadLoans(1, false, false);
    } catch (error) {
      if (error instanceof ApiError && error.cancelled) return;
      Alert.alert('Repayment failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function loadMeetings(page = 1, append = false, navigate = true) {
    if (!session) return;
    if (!permissionsRef.current.includes('meetings:read'))
      return Alert.alert(
        'Access unavailable',
        'Your account does not have permission to view meetings.',
      );
    if (navigate) setScreen('meetings');
    const ticket = requestTracker.current.start('meetings');
    setMeetingsLoading(true);
    try {
      const result = await request<ApiPage<Meeting>>(
        `/meetings?page=${page}&limit=20`,
        undefined,
        session.accessToken,
      );
      const meetingItems = result.items ?? [];
      const withAttendance = await Promise.all(
        meetingItems.map(async (meeting: Meeting) => {
          const attendance = await request<{ user: { id: string }; status: string }[]>(
            `/meetings/${meeting.id}/attendance`,
            undefined,
            session.accessToken,
          );
          const ownAttendance = (attendance ?? []).find((item) => item.user.id === session.user.id);
          return { ...meeting, attendanceStatus: ownAttendance?.status ?? 'NOT_RECORDED' };
        }),
      );
      if (!requestTracker.current.current('meetings', ticket)) return;
      assertPage(result);
      setMeetings((current) => (append ? mergeRecords(current, withAttendance) : withAttendance));
      updatePageInfo('meetings', result);
    } catch (error) {
      if (
        !requestTracker.current.current('meetings', ticket) ||
        (error instanceof ApiError && error.cancelled)
      )
        return;
      Alert.alert(
        'Meetings unavailable',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      if (requestTracker.current.current('meetings', ticket)) setMeetingsLoading(false);
    }
  }

  async function recordMeetingAttendance(
    meeting: Meeting,
    status: 'PRESENT' | 'ABSENT' | 'EXCUSED' | 'LATE',
  ) {
    if (!session) return;
    setAttendanceSubmitting({ meetingId: meeting.id, status });
    try {
      await request(
        `/meetings/${meeting.id}/attendance`,
        { memberUserId: session.user.id, status },
        session.accessToken,
      );
      Alert.alert('Attendance saved', 'Your attendance was recorded.');
      setMeetings((items) =>
        items.map((item) =>
          item.id === meeting.id ? { ...item, attendanceStatus: status } : item,
        ),
      );
    } catch (error) {
      if (error instanceof ApiError && error.cancelled) return;
      Alert.alert(
        'Attendance not saved',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setAttendanceSubmitting(null);
    }
  }

  async function loadNotifications(page = 1, append = false, navigate = true) {
    if (!session) return;
    if (!permissionsRef.current.includes('notifications:read'))
      return Alert.alert(
        'Access unavailable',
        'Your account does not have permission to view notifications.',
      );
    if (navigate) setScreen('notifications');
    const ticket = requestTracker.current.start('notifications');
    setNotificationsLoading(true);
    try {
      const result = await request<ApiPage<NotificationItem> & { unread: number }>(
        `/notifications?page=${page}&limit=20`,
        undefined,
        session.accessToken,
      );
      if (!requestTracker.current.current('notifications', ticket)) return;
      assertPage(result);
      setNotifications((current) => (append ? mergeRecords(current, result.items) : result.items));
      setUnreadCount(result.unread ?? 0);
      updatePageInfo('notifications', result);
    } catch (error) {
      if (
        !requestTracker.current.current('notifications', ticket) ||
        (error instanceof ApiError && error.cancelled)
      )
        return;
      if (screenRef.current === 'dashboard')
        setDashboardError('Notifications are currently unavailable.');
      Alert.alert(
        'Notifications unavailable',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      if (requestTracker.current.current('notifications', ticket)) setNotificationsLoading(false);
    }
  }

  async function loadMembers(page = 1, append = false, navigate = true) {
    if (!session) return;
    if (!permissionsRef.current.includes('members:read'))
      return Alert.alert(
        'Access unavailable',
        'Your account does not have permission to view members.',
      );
    if (navigate) setScreen('members');
    const ticket = requestTracker.current.start('members');
    setMembersLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (memberSearch.trim()) params.set('search', memberSearch.trim());
      if (memberGroupId.trim()) params.set('groupId', memberGroupId.trim());
      const result = await request<ApiPage<Member>>(
        `/members?${params.toString()}`,
        undefined,
        session.accessToken,
      );
      if (!requestTracker.current.current('members', ticket)) return;
      assertPage(result);
      setMembers((current) => (append ? mergeRecords(current, result.items) : result.items));
      updatePageInfo('members', result);
    } catch (error) {
      if (
        !requestTracker.current.current('members', ticket) ||
        (error instanceof ApiError && error.cancelled)
      )
        return;
      Alert.alert(
        'Members unavailable',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      if (requestTracker.current.current('members', ticket)) setMembersLoading(false);
    }
  }

  async function openMember(member: Member) {
    if (!session) return;
    const sourceScreen = screenRef.current;
    const ticket = requestTracker.current.start('members');
    setMembersLoading(true);
    try {
      const result = await request<Member>(`/members/${member.id}`, undefined, session.accessToken);
      if (!requestTracker.current.current('members', ticket)) return;
      setSelectedMember(result);
      if (screenRef.current === sourceScreen) setScreen('memberDetail');
    } catch (error) {
      if (
        !requestTracker.current.current('members', ticket) ||
        (error instanceof ApiError && error.cancelled)
      )
        return;
      Alert.alert(
        'Member details unavailable',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      if (requestTracker.current.current('members', ticket)) setMembersLoading(false);
    }
  }

  async function searchMemberAccounts() {
    if (!session || !permissionsRef.current.includes('users:read')) return;
    const ticket = requestTracker.current.start('memberAccounts');
    setMemberAccountsLoading(true);
    try {
      const params = new URLSearchParams({
        role: 'MEMBER',
        status: 'ACTIVE',
        limit: '20',
        search: memberAccountSearch.trim(),
      });
      const result = await request<ApiPage<Profile>>(
        `/users?${params}`,
        undefined,
        session.accessToken,
      );
      if (!requestTracker.current.current('memberAccounts', ticket)) return;
      assertPage(result);
      setMemberAccounts(result.items);
    } catch (error) {
      if (
        !requestTracker.current.current('memberAccounts', ticket) ||
        (error instanceof ApiError && error.cancelled)
      )
        return;
      Alert.alert(
        'Accounts unavailable',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      if (requestTracker.current.current('memberAccounts', ticket)) setMemberAccountsLoading(false);
    }
  }

  function openAddMember() {
    if (!permissionsRef.current.includes('members:manage')) return;
    setNewMemberUserId('');
    setNewMemberGroupId('');
    setMemberAccounts([]);
    setMemberAccountSearch('');
    setScreen('addMember');
    void loadGroups();
  }

  async function submitMember() {
    if (!session || submitting || !permissionsRef.current.includes('members:manage')) return;
    if (!newMemberUserId.trim() || !newMemberGroupId.trim())
      return Alert.alert(
        'Missing details',
        'Choose a registered member account and a community group.',
      );
    const ticket = requestTracker.current.start('addMember');
    setSubmitting(true);
    try {
      const member = await request<Member>(
        '/members',
        {
          userId: newMemberUserId.trim(),
          groupId: newMemberGroupId.trim(),
        },
        session.accessToken,
      );
      if (!requestTracker.current.current('addMember', ticket)) return;
      setSelectedMember(member);
      setNewMemberUserId('');
      setNewMemberGroupId('');
      setScreen('memberDetail');
      Alert.alert(
        'Member added',
        `${member.user.firstName} ${member.user.lastName} has been added to the group.`,
      );
    } catch (error) {
      if (
        !requestTracker.current.current('addMember', ticket) ||
        (error instanceof ApiError && error.cancelled)
      )
        return;
      Alert.alert(
        'Could not add member',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      if (requestTracker.current.current('addMember', ticket)) setSubmitting(false);
    }
  }

  async function loadTransactions(page = 1, append = false, navigate = true) {
    if (!session) return;
    const dateError = dateRangeError(transactionFrom.trim(), transactionTo.trim());
    if (dateError) return Alert.alert('Check dates', dateError);
    if (!permissionsRef.current.includes('financial:read'))
      return Alert.alert(
        'Access unavailable',
        'Your account does not have permission to view financial records.',
      );
    if (navigate) setScreen('transactions');
    const ticket = requestTracker.current.start('transactions');
    setTransactionsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (transactionSearch.trim()) params.set('search', transactionSearch.trim());
      if (transactionType.trim()) params.set('type', transactionType.trim().toUpperCase());
      if (transactionStatus.trim()) params.set('status', transactionStatus.trim().toUpperCase());
      if (transactionFrom.trim()) params.set('from', transactionFrom.trim());
      if (transactionTo.trim()) params.set('to', transactionTo.trim());
      const result = await request<ApiPage<FinancialRecord>>(
        `/financial-records?${params.toString()}`,
        undefined,
        session.accessToken,
      );
      if (!requestTracker.current.current('transactions', ticket)) return;
      assertPage(result);
      setTransactions((current) => (append ? mergeRecords(current, result.items) : result.items));
      updatePageInfo('transactions', result);
    } catch (error) {
      if (
        !requestTracker.current.current('transactions', ticket) ||
        (error instanceof ApiError && error.cancelled)
      )
        return;
      Alert.alert(
        'Transactions unavailable',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      if (requestTracker.current.current('transactions', ticket)) setTransactionsLoading(false);
    }
  }

  async function loadReports() {
    if (!session) return;
    const dateError = dateRangeError(reportFrom.trim(), reportTo.trim());
    if (dateError) return Alert.alert('Check dates', dateError);
    if (!permissionsRef.current.includes('financial:read'))
      return Alert.alert(
        'Access unavailable',
        'Your account does not have permission to view reports.',
      );
    setScreen('reports');
    const ticket = requestTracker.current.start('reports');
    setReportsLoading(true);
    setReport(null);
    try {
      const params = new URLSearchParams();
      if (reportFrom.trim()) params.set('from', reportFrom.trim());
      if (reportTo.trim()) params.set('to', reportTo.trim());
      if (reportGroupId.trim()) params.set('group', reportGroupId.trim());
      if (reportMemberId.trim()) params.set('member', reportMemberId.trim());
      if (reportTransactionType.trim())
        params.set('transactionType', reportTransactionType.trim().toUpperCase());
      if (reportLoanStatus.trim()) params.set('loanStatus', reportLoanStatus.trim().toUpperCase());
      const result = await request<ReportAnalytics>(
        `/reports/analytics${params.size ? `?${params.toString()}` : ''}`,
        undefined,
        session.accessToken,
      );
      if (!requestTracker.current.current('reports', ticket)) return;
      setReport(result);
    } catch (error) {
      if (
        !requestTracker.current.current('reports', ticket) ||
        (error instanceof ApiError && error.cancelled)
      )
        return;
      Alert.alert(
        'Reports unavailable',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      if (requestTracker.current.current('reports', ticket)) setReportsLoading(false);
    }
  }

  async function loadBlockchain() {
    if (!session) return;
    if (
      !permissionsRef.current.includes('financial:read') &&
      !permissionsRef.current.includes('loans:read')
    )
      return Alert.alert(
        'Access unavailable',
        'Your account does not have permission to verify blockchain records.',
      );
    setScreen('blockchain');
    const ticket = requestTracker.current.start('blockchain');
    setBlockchainLoading(true);
    setBlockchainResult(null);
    setProofResult(null);
    try {
      const result = permissionsRef.current.includes('loans:read')
        ? await request<{ configured: boolean }>(
            '/blockchain/status',
            undefined,
            session.accessToken,
          )
        : null;
      if (!requestTracker.current.current('blockchain', ticket)) return;
      setBlockchainStatus(result);
    } catch (error) {
      if (
        !requestTracker.current.current('blockchain', ticket) ||
        (error instanceof ApiError && error.cancelled)
      )
        return;
      Alert.alert(
        'Blockchain status unavailable',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      if (requestTracker.current.current('blockchain', ticket)) setBlockchainLoading(false);
    }
  }

  async function verifyTransaction() {
    if (!session || !permissionsRef.current.includes('financial:read'))
      return Alert.alert(
        'Access unavailable',
        'Your account does not have permission to verify transactions.',
      );
    if (!transactionIdInput.trim())
      return Alert.alert(
        'Transaction ID required',
        'Enter the transaction UUID from transaction history.',
      );
    const ticket = requestTracker.current.start('blockchain');
    setBlockchainLoading(true);
    setBlockchainResult(null);
    try {
      const result = await request<TransactionVerification>(
        `/blockchain/verify/${encodeURIComponent(transactionIdInput.trim())}`,
        undefined,
        session.accessToken,
      );
      if (!requestTracker.current.current('blockchain', ticket)) return;
      setBlockchainResult(result);
    } catch (error) {
      if (
        !requestTracker.current.current('blockchain', ticket) ||
        (error instanceof ApiError && error.cancelled)
      )
        return;
      Alert.alert(
        'Verification failed',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      if (requestTracker.current.current('blockchain', ticket)) setBlockchainLoading(false);
    }
  }

  async function verifyProof() {
    if (!session || !permissionsRef.current.includes('financial:read'))
      return Alert.alert(
        'Access unavailable',
        'Your account does not have permission to verify proofs.',
      );
    if (!proofReferenceInput.trim() || !expectedHashInput.trim())
      return Alert.alert('Missing details', 'Enter the proof reference and expected record hash.');
    const ticket = requestTracker.current.start('blockchain');
    setBlockchainLoading(true);
    setProofResult(null);
    try {
      const result = await request<{
        transactionHash: string;
        blockNumber: number;
        verified: boolean;
      }>(`/blockchain/proofs/${encodeURIComponent(proofReferenceInput.trim())}/verify`, {
        expectedRecordHash: expectedHashInput.trim(),
      });
      if (!requestTracker.current.current('blockchain', ticket)) return;
      setProofResult(result);
    } catch (error) {
      if (
        !requestTracker.current.current('blockchain', ticket) ||
        (error instanceof ApiError && error.cancelled)
      )
        return;
      Alert.alert(
        'Proof verification failed',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      if (requestTracker.current.current('blockchain', ticket)) setBlockchainLoading(false);
    }
  }

  async function loadSettings() {
    if (!session) return;
    setScreen('settings');
    const ticket = requestTracker.current.start('settings');
    setSettingsLoading(true);
    try {
      const [account, values] = await Promise.all([
        request<Profile>('/users/' + session.user.id),
        permissionsRef.current.includes('settings:manage')
          ? request<SystemSetting[]>('/system/settings')
          : Promise.resolve([] as SystemSetting[]),
      ]);
      if (!requestTracker.current.current('settings', ticket)) return;
      setProfile(account);
      setSettings(values);
    } catch (error) {
      if (
        requestTracker.current.current('settings', ticket) &&
        !(error instanceof ApiError && error.cancelled)
      )
        Alert.alert(
          'Settings unavailable',
          error instanceof Error ? error.message : 'Please try again.',
        );
    } finally {
      if (requestTracker.current.current('settings', ticket)) setSettingsLoading(false);
    }
  }

  function editSetting(setting: SystemSetting) {
    setSettingKey(setting.key);
    setSettingValue(JSON.stringify(setting.value, null, 2));
  }

  async function saveSetting() {
    if (!session || !permissionsRef.current.includes('settings:manage'))
      return Alert.alert(
        'Access unavailable',
        'System settings are available to administrators only.',
      );
    if (!settingKey.trim())
      return Alert.alert('Setting key required', 'Choose a setting to update.');
    let value: unknown;
    try {
      value = JSON.parse(settingValue);
    } catch {
      return Alert.alert('Invalid JSON', 'Enter a valid JSON object.');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return Alert.alert('Invalid value', 'Settings must be saved as a JSON object.');
    setSubmitting(true);
    try {
      const updated = await request<SystemSetting>(
        `/system/settings/${encodeURIComponent(settingKey)}`,
        { value },
        session.accessToken,
        'PATCH',
      );
      setSettings((items) => items.map((item) => (item.key === updated.key ? updated : item)));
      Alert.alert('Setting saved', `${updated.key} was updated.`);
    } catch (error) {
      if (error instanceof ApiError && error.cancelled) return;
      Alert.alert(
        'Setting update failed',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function readNotification(item: NotificationItem) {
    if (!session || notificationPending.current || item.status === 'READ') return;
    notificationPending.current = true;
    setNotificationsUpdating(true);
    try {
      await request(`/notifications/${item.id}/read`, {}, session.accessToken, 'PATCH');
      setNotifications((items) =>
        items.map((notification) =>
          notification.id === item.id
            ? { ...notification, status: 'READ', readAt: new Date().toISOString() }
            : notification,
        ),
      );
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch (error) {
      if (error instanceof ApiError && error.cancelled) return;
      Alert.alert(
        'Notification update failed',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      notificationPending.current = false;
      setNotificationsUpdating(false);
    }
  }

  async function markAllNotificationsRead() {
    if (!session || notificationPending.current) return;
    notificationPending.current = true;
    setNotificationsUpdating(true);
    try {
      await request('/notifications/read-all', {}, session.accessToken);
      setNotifications((items) =>
        items.map((item) => ({ ...item, status: 'READ', readAt: new Date().toISOString() })),
      );
      setUnreadCount(0);
    } catch (error) {
      if (error instanceof ApiError && error.cancelled) return;
      Alert.alert(
        'Notification update failed',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      notificationPending.current = false;
      setNotificationsUpdating(false);
    }
  }

  async function restoreSession() {
    try {
      const [{ accessToken, refreshToken }] = await Promise.all([
        getStoredTokens(),
        new Promise((resolve) => setTimeout(resolve, 1200)),
      ]);
      if (accessToken && refreshToken) {
        const user = await request<Session['user']>('/auth/me', undefined, accessToken);
        const current = await getStoredTokens();
        if (!current.accessToken || !current.refreshToken)
          throw new ApiError('Your session expired. Please sign in again.', 401);
        setSession({ accessToken: current.accessToken, refreshToken: current.refreshToken, user });
        setScreen('dashboard');
      } else {
        setScreen(signIn === '1' ? 'login' : 'onboarding');
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await clearTokens();
        setScreen('login');
      } else {
        setScreen('login');
        Alert.alert(
          'Connection unavailable',
          error instanceof Error ? error.message : 'Could not verify your saved session.',
        );
      }
    } finally {
      setLoading(false);
    }
  }

  async function saveSession(next: Session, isCurrent: () => boolean = () => true) {
    if (!isCurrent()) throw new ApiError('Wallet account changed. Sign in again.', 0, [], true);
    if (
      !next?.user ||
      typeof next.user.id !== 'string' ||
      !next.user.id ||
      typeof next.user.role !== 'string' ||
      !next.user.role
    )
      throw new ApiError('The server returned invalid account details. Please try again.', 0);
    await storeTokens(next.accessToken, next.refreshToken);
    if (!isCurrent()) {
      const stored = await getStoredTokens();
      if (stored.accessToken === next.accessToken) await clearTokens();
      throw new ApiError('Wallet account changed. Sign in again.', 0, [], true);
    }
    setDashboardLoading(true);
    setSession(next);
    setScreen('dashboard');
  }

  async function submitLogin() {
    if (!identifier.trim() || !password)
      return Alert.alert('Missing details', 'Enter your member ID, email or phone number and password.');
    setSubmitting(true);
    try {
      await saveSession(await request('/auth/login', { identifier: identifier.trim(), password }));
    } catch (error) {
      if (error instanceof ApiError && error.cancelled) return;
      const unavailable = error instanceof ApiError && (error.status === 0 || error.status === 503);
      const message = error instanceof Error ? error.message : 'Please try again.';
      Alert.alert(
        unavailable ? 'Connection unavailable' : 'Sign in failed',
        unavailable
          ? `${message}\nYour existing account does not need to be recreated. Retry sign-in when the connection returns.`
          : message,
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitGoogleLogin() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const idToken = await googleIdToken();
      if (!idToken) return;
      await saveSession(await request<Session>('/auth/google', { idToken }));
    } catch (error) {
      if (error instanceof ApiError && error.cancelled) return;
      Alert.alert('Google sign-in failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRegistration() {
    const errors = registrationErrors({
      memberId,
      firstName,
      lastName,
      email,
      phone,
      password,
      confirmation,
      groupId: role === 'MEMBER' ? groupId : '',
    });
    setFormErrors(errors);
    if (Object.keys(errors).length)
      return Alert.alert('Check your details', 'Correct the highlighted fields and try again.');
    setSubmitting(true);
    try {
      const registration = await request<Session | { pendingApproval: true; message: string }>('/auth/register', {
          memberId: memberId.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          password,
          passwordConfirmation: confirmation,
          role,
          groupId: role === 'MEMBER' && groupId.trim() ? groupId.trim() : undefined,
        });
      if ('pendingApproval' in registration) {
        setIdentifier(memberId.trim());
        setPassword('');
        setConfirmation('');
        setScreen('login');
        Alert.alert('Account awaiting approval', registration.message);
      } else {
        await saveSession(registration);
      }
    } catch (error) {
      if (error instanceof ApiError && error.cancelled) return;
      if (error instanceof ApiError && error.status === 409) {
        setIdentifier(error.message.includes('Member ID') ? memberId.trim() : email.trim() || phone.trim());
        setPassword('');
        setScreen('login');
        Alert.alert(
          'Account already registered',
          'An account with these details already exists. Sign in using your original member ID, email or phone and password. Use Forgot password with your email or phone if you need to reset it.',
        );
        return;
      }
      const unconfirmed = error instanceof ApiError && (error.status === 0 || error.status === 503);
      const message = error instanceof Error ? error.message : 'Please try again.';
      Alert.alert(
        unconfirmed ? 'Registration could not be confirmed' : 'Registration failed',
        unconfirmed
          ? `${message}\nTry signing in with these details before registering again.`
          : message,
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitForgot() {
    if (!identifier.trim())
      return Alert.alert('Identifier required', 'Enter your email address or phone number.');
    setSubmitting(true);
    try {
      await request('/auth/forgot-password', { identifier: identifier.trim() });
      Alert.alert('Request received', 'If that account exists, reset instructions have been sent.');
      setScreen('login');
    } catch (error) {
      if (error instanceof ApiError && error.cancelled) return;
      Alert.alert('Request failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    invalidateWalletRequest();
    selectWallet('');
    const { refreshToken } = await getStoredTokens();
    await clearTokens();
    resetLocalSession();
    // Clear the app immediately; a disconnected relay must not block logout.
    void endWalletConnection().catch(() => undefined);
    if (refreshToken) {
      try {
        await request('/auth/logout', { refreshToken });
      } catch {
        /* Local logout has already completed when the connection is unavailable. */
      }
    }
  }

  function resetLocalSession() {
    requestTracker.current.clear();
    setMemberId('');
    setWorkflowSummary(null);
    setNewMemberUserId('');
    setNewMemberGroupId('');
    setMemberAccountSearch('');
    setMemberAccounts([]);
    setMemberAccountsLoading(false);
    setProfileLoading(false);
    setGroupsLoading(false);
    setSavingsLoading(false);
    setLoansLoading(false);
    setMeetingsLoading(false);
    setMembersLoading(false);
    setTransactionsLoading(false);
    setReportsLoading(false);
    setBlockchainLoading(false);
    setSettingsLoading(false);
    setNotificationsLoading(false);
    setAdminDashboardLoading(false);
    setRefreshing(false);
    setLoadingMore(false);
    setSubmitting(false);
    setProfileError(null);
    setDashboardError(null);
    setSavingsSummary(null);
    permissionsRef.current = [];
    setPermissions([]);
    setMembers([]);
    setSelectedMember(null);
    setTransactions([]);
    setReport(null);
    setSettings([]);
    setSettingKey('');
    setSettingValue('');
    setBlockchainResult(null);
    setProofResult(null);
    setPageInfo({});
    setSelectedLoan(null);
    setStatementTotals({});
    setRepaymentAmounts({});
    paymentReferences.current.clear();
    setContributionAmounts({});
    setContributionMethods({});
    setLoanAmount('');
    setSession(null);
    setProfile(null);
    setGroups([]);
    setSelectedGroup(null);
    setSavingsAccounts([]);
    setContributions([]);
    setLoans([]);
    setLoanApplications([]);
    setRepayments([]);
    setMeetings([]);
    setNotifications([]);
    setUnreadCount(0);
    setAdminDashboard(null);
    setAdminDashboardError(null);
    setPassword('');
    setConfirmation('');
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
    setIdentifier('');
    setGroupId('');
    setFormErrors({});
    setContributionDescriptions({});
    setLoanPurpose('');
    setLoanDuration('');
    setLoanApplicationDate('');
    setLoanSupportingInformation('');
    setMemberSearch('');
    setMemberGroupId('');
    setHistorySearch('');
    setHistoryFrom('');
    setHistoryTo('');
    setTransactionSearch('');
    setTransactionType('');
    setTransactionStatus('');
    setTransactionFrom('');
    setTransactionTo('');
    setReportFrom('');
    setReportTo('');
    setReportGroupId('');
    setReportMemberId('');
    setReportTransactionType('');
    setReportLoanStatus('');
    setTransactionIdInput('');
    setProofReferenceInput('');
    setExpectedHashInput('');
    setBlockchainStatus(null);
    setScreen('login');
  }

  async function saveProfile() {
    if (!session || !profile) return;
    if (!profile.firstName.trim() || !profile.lastName.trim())
      return Alert.alert('Missing details', 'First and last name are required.');
    const ticket = requestTracker.current.start('profile');
    setSubmitting(true);
    try {
      const saved = await request<Profile>(
        `/users/${profile.id}`,
        {
          firstName: profile.firstName,
          lastName: profile.lastName,
          email: profile.email || undefined,
          phone: profile.phone || undefined,
          profileImageUrl: profile.profileImageUrl || undefined,
        },
        session.accessToken,
        'PATCH',
      );
      if (!requestTracker.current.current('profile', ticket)) return;
      setProfile(saved);
      Alert.alert('Profile updated', 'Your profile changes were saved.');
    } catch (error) {
      if (error instanceof ApiError && error.cancelled) return;
      Alert.alert(
        'Profile update failed',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || screen === 'splash') {
    return (
      <View style={styles.splashContainer}>
        <StatusBar style="light" />
        <Image
          source={
            // Metro requires a static require for bundled image assets.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../assets/splash.png')
          }
          style={styles.splashImage}
          resizeMode="contain"
          accessibilityLabel="Rural Community Microfinance"
        />
        <ActivityIndicator
          accessibilityLabel="Loading"
          size="large"
          color="#EAB85C"
          style={styles.splashSpinner}
        />
      </View>
    );
  }

  if (screen === 'onboarding') {
    const slide = onboardingSlides[onboardingIndex];
    return (
      <ScrollView contentContainerStyle={styles.onboardingContainer}>
        <Text style={styles.brand}>Rural Microfinance</Text>
        <View style={[styles.onboardingCard, { borderColor: slide.accent }]}>
          <View style={[styles.onboardingIcon, { backgroundColor: slide.accent }]}>
            <Text style={styles.onboardingIconText}>{onboardingIndex + 1}</Text>
          </View>
          <Text accessibilityRole="header" aria-level={1} style={styles.title}>
            {slide.title}
          </Text>
          <Text style={styles.detail}>{slide.description}</Text>
        </View>
        <View style={styles.dotRow}>
          {onboardingSlides.map((_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                onboardingIndex === index
                  ? [styles.dotActive, { backgroundColor: slide.accent }]
                  : styles.dotInactive,
              ]}
            />
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          style={[
            styles.primaryButton,
            onboardingIndex === onboardingSlides.length - 1 && styles.primaryButtonLarge,
          ]}
          onPress={() =>
            onboardingIndex === onboardingSlides.length - 1
              ? setScreen('login')
              : setOnboardingIndex((current) => current + 1)
          }
        >
          <Text style={styles.primaryText}>
            {onboardingIndex === onboardingSlides.length - 1 ? 'Get started' : 'Next'}
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setScreen('login')}>
          <Text style={styles.link}>Skip</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (screen === 'treasurerManagement' && session && ['TREASURER', 'ADMIN', 'SUPER_ADMIN'].includes(session.user.role)) {
    return <TreasurerConsole onBack={() => { setScreen('dashboard'); void loadWorkflowSummary(); }} onRecordContribution={() => { setScreen('contributions'); void loadSavings(1, false, false); }} onVerifyContributions={() => setScreen('reviewRequests')} onReports={() => void loadReports()} onHistory={() => void loadTransactions()} />;
  }

  if (screen === 'adminManagement' && session && ['ADMIN', 'SUPER_ADMIN'].includes(session.user.role)) {
    return <AdminConsole userId={session.user.id} onBack={() => { setScreen('dashboard'); void loadAdminDashboard(); }} onLoans={() => void loadLoans()} onContributions={() => setScreen('reviewRequests')} onReports={() => void loadReports()} />;
  }

  if (screen === 'memberSpace' && session && session.user.role === 'MEMBER') {
    return <MemberSpace onBack={() => { setScreen('dashboard'); void loadWorkflowSummary(); }} onPay={() => setScreen('payContribution')} onRepay={() => setScreen('payRepayment')} onApply={() => setScreen('loanApplication')} onHistory={() => { void loadSavings(); }} onSavings={() => { void loadSavings(); }} onNotifications={() => { void loadNotifications(); }} />;
  }

  if (screen === 'dashboard' && session) {
    const isAdminDashboard = ['ADMIN', 'SUPER_ADMIN'].includes(session.user.role);
    const quickActions = [
      ...(session.user.role === 'MEMBER' ? [{ label: 'Member workspace', permission: undefined, onPress: () => setScreen('memberSpace') }] : []),
      ...(['TREASURER', 'ADMIN', 'SUPER_ADMIN'].includes(session.user.role) ? [{ label: session.user.role === 'TREASURER' ? 'Treasurer workspace' : 'Financial operations', permission: undefined, onPress: () => setScreen('treasurerManagement') }] : []),
      { label: 'Profile', permission: undefined, onPress: () => setScreen('profile') },
      { label: 'Groups', permission: 'groups:read', onPress: () => setScreen('groups') },
      { label: 'Savings', permission: 'financial:read', onPress: () => void loadSavings() },
      { label: 'Loans', permission: 'loans:read', onPress: () => void loadLoans() },
      { label: 'Meetings', permission: 'meetings:read', onPress: () => void loadMeetings() },
      {
        label: 'Notifications',
        permission: 'notifications:read',
        onPress: () => void loadNotifications(),
      },
      { label: 'Members', permission: 'members:read', onPress: () => void loadMembers() },
      {
        label: 'Transactions',
        permission: 'financial:read',
        onPress: () => void loadTransactions(),
      },
      { label: 'Reports', permission: 'financial:read', onPress: () => void loadReports() },
      {
        label: 'Blockchain',
        permission: 'financial:read|loans:read',
        onPress: () => void loadBlockchain(),
      },
      {
        label: 'Settings',
        permission: undefined,
        onPress: () => {
          void loadSettings();
        },
      },
    ].filter(
      (item) =>
        !item.permission ||
        item.permission.split('|').some((permission) => permissions.includes(permission)),
    );
    const community = groups[0];
    const financialActivity = [
      ...contributions.map((item) => ({
        id: 'saving-' + item.id,
        title: 'Savings contribution',
        date: item.contributionDate,
        amount: item.amount,
        outgoing: false,
      })),
      ...repayments.map((item) => ({
        id: 'repayment-' + item.id,
        title: 'Loan repayment',
        date: item.paidAt,
        amount: item.amount,
        outgoing: true,
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const activity = isAdminDashboard
      ? (adminDashboard?.recentTransactions ?? []).map((item) => ({
          id: item.id,
          title: item.type
            .replaceAll('_', ' ')
            .toLowerCase()
            .replace(/^./, (letter) => letter.toUpperCase()),
          date: item.occurredAt,
          amount: item.amount,
          outgoing: item.type.includes('REPAYMENT'),
        }))
      : financialActivity.length
        ? financialActivity
        : notifications.map((item) => ({
            id: item.id,
            title: item.title,
            date: item.createdAt,
            detail: item.message,
          }));
    return (
      <Dashboard
        role={session.user.role}
        totalSavings={
          isAdminDashboard ? adminDashboard?.metrics.totalSavings : workflowSummary?.totalSavings ?? savingsSummary?.totalBalance
        }
        loading={dashboardLoading || (isAdminDashboard && adminDashboardLoading)}
        error={isAdminDashboard ? adminDashboardError : dashboardError}
        refreshing={refreshing}
        onRefresh={() => void refreshScreen()}
        onLogout={() => void logout()}
        memberId={workflowSummary?.memberId ?? session.user.memberId}
        unreadNotifications={workflowSummary?.unread ?? unreadCount}
        onPayContribution={session.user.role === 'MEMBER' ? () => setScreen('payContribution') : undefined}
        onRepayLoan={session.user.role === 'MEMBER' ? () => setScreen('payRepayment') : undefined}
        onApplyLoan={session.user.role === 'MEMBER' ? () => setScreen('loanApplication') : undefined}
        onReviewRequests={['TREASURER','GROUP_MANAGER','ADMIN','SUPER_ADMIN'].includes(session.user.role) ? () => setScreen('reviewRequests') : undefined}
        onAddMember={permissions.includes('members:manage') ? openAddMember : undefined}
        onNotifications={
          permissions.includes('notifications:read') ? () => void loadNotifications() : undefined
        }
        onSavings={permissions.includes('financial:read') ? () => void loadSavings() : undefined}
        onLoans={permissions.includes('loans:read') ? () => void loadLoans() : undefined}
        onHistory={
          permissions.includes('financial:read') ? () => void loadTransactions() : undefined
        }
        onBlockchain={
          permissions.some((permission) => ['financial:read', 'loans:read'].includes(permission))
            ? () => void loadBlockchain()
            : undefined
        }
        blockchainVerified={blockchainResult?.verificationResult === 'VERIFIED'}
        community={
          community
            ? {
                name: community.name,
                members:
                  selectedGroup?.id === community.id
                    ? selectedGroup.statistics.totalMembers
                    : undefined,
                onPress: () => void openGroup(community),
              }
            : undefined
        }
        activities={activity}
        actions={quickActions.filter(
          (action) => !['Savings', 'Loans', 'Notifications', 'Blockchain'].includes(action.label),
        )}
      >
        {session.user.walletAddress && <WalletAuth sessionWallet={session.user.walletAddress} onEndSession={logout} />}
        {isAdminDashboard && (
          <>
            <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
              Admin dashboard
            </Text>
            <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={() => setScreen('adminManagement')}>
              <Text style={styles.primaryText}>Manage platform</Text>
            </Pressable>
            <AdminDashboardPanel
              data={adminDashboard}
              loading={dashboardLoading || adminDashboardLoading}
              error={adminDashboardError}
              onRetry={() => void loadAdminDashboard()}
            />
          </>
        )}
      </Dashboard>
    );
  }

  if (screen === 'profile' && session) {
    if (profileLoading || !profile)
      return (
        <ScrollView contentContainerStyle={styles.container}>
          <Text accessibilityRole="header" aria-level={1} style={styles.title}>
            My profile
          </Text>
          {profileLoading ? (
            <ActivityIndicator accessibilityLabel="Loading profile" size="large" color="#0F766E" />
          ) : (
            <>
              <Text style={styles.detail}>
                {profileError ?? 'Your profile could not be loaded.'}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void loadProfile()}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryText}>Retry</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      );
    return (
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>Rural Microfinance</Text>
        <Text accessibilityRole="header" aria-level={1} style={styles.title}>
          My profile
        </Text>
        <Text style={styles.status}>Account status: {profile.status}</Text>
        <Field
          label="First name"
          value={profile.firstName}
          onChangeText={(firstName) => setProfile({ ...profile, firstName })}
        />
        <Field
          label="Last name"
          value={profile.lastName}
          onChangeText={(lastName) => setProfile({ ...profile, lastName })}
        />
        <Field
          label="Email address"
          value={profile.email ?? ''}
          onChangeText={(email) => setProfile({ ...profile, email })}
          keyboardType="email-address"
        />
        <Field
          label="Phone number"
          value={profile.phone ?? ''}
          onChangeText={(phone) => setProfile({ ...profile, phone })}
          keyboardType="phone-pad"
        />
        <Field
          label="Profile image URL"
          value={profile.profileImageUrl ?? ''}
          onChangeText={(profileImageUrl) => setProfile({ ...profile, profileImageUrl })}
        />
        <Text style={styles.detail}>{roleLabel(profile.role.name)}</Text>
        <WalletAuth linkToken={session?.accessToken} linkedAddress={profile.blockchainAddress} sessionWallet={session?.user.walletAddress} onEndSession={logout} />
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => setScreen('groups')}
        >
          <Text style={styles.secondaryText}>View community groups</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => void loadSavings()}
        >
          <Text style={styles.secondaryText}>Savings dashboard</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => void loadLoans()}
        >
          <Text style={styles.secondaryText}>Loan applications</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => void loadMeetings()}
        >
          <Text style={styles.secondaryText}>Meetings and attendance</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => void loadNotifications()}
        >
          <Text style={styles.secondaryText}>
            Notifications{unreadCount > 0 ? ` (${unreadCount} new)` : ''}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={[styles.primaryButton, submitting && styles.disabled]}
          disabled={submitting}
          onPress={() => void saveProfile()}
        >
          <Text style={styles.primaryText}>{submitting ? 'Saving...' : 'Save profile'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => void logout()}
        >
          <Text style={styles.secondaryText}>Log out</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (screen === 'notifications' && session)
    return (
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>Rural Microfinance</Text>
        <Text accessibilityRole="header" aria-level={1} style={styles.title}>
          Notifications
        </Text>
        {unreadCount > 0 && <Text style={styles.unreadSummary}>{unreadCount} unread</Text>}
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => setScreen('dashboard')}
        >
          <Text style={styles.secondaryText}>Back to dashboard</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          disabled={notificationsUpdating || unreadCount === 0}
          accessibilityState={{ disabled: notificationsUpdating || unreadCount === 0 }}
          onPress={() => void markAllNotificationsRead()}
        >
          <Text style={styles.secondaryText}>
            {notificationsUpdating ? 'Saving...' : 'Mark all as read'}
          </Text>
        </Pressable>
        {notificationsLoading && (
          <ActivityIndicator
            accessibilityLabel="Loading"
            size="large"
            color="#0F766E"
            style={styles.loader}
          />
        )}
        {!notificationsLoading && notifications.length === 0 && (
          <Text style={styles.detail}>No notifications.</Text>
        )}
        {notifications.map((item) => {
          const unread = item.status !== 'READ';
          return (
            <Pressable
              accessibilityRole="button"
              key={item.id}
              style={unread ? styles.historyItemUnread : styles.historyItem}
              disabled={notificationsUpdating}
              accessibilityState={{ disabled: notificationsUpdating }}
              onPress={() => void readNotification(item)}
            >
              <View style={styles.notificationHeader}>
                <Text style={unread ? styles.groupNameUnread : styles.groupName}>{item.title}</Text>
                {unread && (
                  <View style={styles.newBadge}>
                    <Text style={styles.newBadgeText}>NEW</Text>
                  </View>
                )}
              </View>
              <Text style={styles.detail}>{item.message}</Text>
              <Text style={styles.groupMeta}>
                {item.type} · {new Date(item.createdAt).toLocaleString()} · {item.status}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    );

  if ((screen === 'meetings' || screen === 'attendance') && session)
    return (
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>Rural Microfinance</Text>
        <Text accessibilityRole="header" aria-level={1} style={styles.title}>
          {screen === 'attendance' ? 'Attendance' : 'Meetings'}
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => setScreen('profile')}
        >
          <Text style={styles.secondaryText}>Back to profile</Text>
        </Pressable>
        {meetingsLoading && (
          <ActivityIndicator
            accessibilityLabel="Loading"
            size="large"
            color="#0F766E"
            style={styles.loader}
          />
        )}
        {!meetingsLoading && meetings.length === 0 && (
          <Text style={styles.detail}>No meetings found.</Text>
        )}
        {meetings.map((meeting) => (
          <View key={meeting.id} style={styles.historyItem}>
            <Text style={styles.groupName}>
              {meeting.title} · {meeting.status}
            </Text>
            <Text style={styles.detail}>
              {meeting.group.name} · {new Date(meeting.scheduledAt).toLocaleString()}
            </Text>
            <Text style={styles.detail}>
              Location: {meeting.location ?? 'Not set'} · Organizer: {meeting.organizer.firstName}{' '}
              {meeting.organizer.lastName}
            </Text>
            {meeting.agenda && <Text style={styles.groupMeta}>Agenda: {meeting.agenda}</Text>}
            {meeting.description && <Text style={styles.groupMeta}>{meeting.description}</Text>}
            {screen === 'attendance' ? (
              <>
                <Text style={styles.status}>
                  My attendance: {meeting.attendanceStatus ?? 'NOT_RECORDED'}
                </Text>
                <View style={styles.attendanceOptions}>
                  {(['PRESENT', 'ABSENT', 'EXCUSED', 'LATE'] as const).map((status) => {
                    const saving = attendanceSubmitting !== null;
                    return (
                      <Pressable
                        accessibilityRole="button"
                        key={status}

                        accessibilityState={{
                          selected: meeting.attendanceStatus === status,
                          disabled: saving,
                        }}
                        style={[
                          styles.attendanceOption,
                          meeting.attendanceStatus === status && styles.attendanceOptionSelected,
                          saving && styles.disabled,
                        ]}
                        disabled={saving}
                        onPress={() => void recordMeetingAttendance(meeting, status)}
                      >
                        <Text
                          style={[
                            styles.attendanceOptionText,
                            meeting.attendanceStatus === status &&
                              styles.attendanceOptionTextSelected,
                          ]}
                        >
                          {saving &&
                          attendanceSubmitting?.meetingId === meeting.id &&
                          attendanceSubmitting.status === status
                            ? 'Saving...'
                            : status.charAt(0) + status.slice(1).toLowerCase()}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : (
              <Pressable
                accessibilityRole="button"
                style={styles.secondaryButton}
                onPress={() => setScreen('attendance')}
              >
                <Text style={styles.secondaryText}>View and record attendance</Text>
              </Pressable>
            )}
          </View>
        ))}
      </ScrollView>
    );

  if ((screen === 'savings' || screen === 'contributions') && session)
    return (
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>Rural Microfinance</Text>
        <Text accessibilityRole="header" aria-level={1} style={styles.title}>
          {screen === 'contributions' ? 'Contributions' : 'Savings'}
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => setScreen('profile')}
        >
          <Text style={styles.secondaryText}>Back to profile</Text>
        </Pressable>
        {savingsLoading && (
          <ActivityIndicator
            accessibilityLabel="Loading"
            size="large"
            color="#0F766E"
            style={styles.loader}
          />
        )}
        {!savingsLoading && savingsAccounts.length === 0 && (
          <Text style={styles.detail}>
            No savings account is available yet. Ask your group manager to open one.
          </Text>
        )}
        {savingsAccounts.map((account) => (
          <View key={account.id} style={styles.groupCard}>
            <Text style={styles.groupName}>{account.accountNumber}</Text>
            <Text style={styles.detail}>
              {account.groupMember.group.name} · {account.groupMember.memberNumber}
            </Text>
            <Text style={styles.status}>Balance: SLE {String(account.balance)}</Text>
            <Text style={styles.detail}>
              Statement: {statementTotals[account.id]?.count ?? 'Unavailable'} contributions · SLE{' '}
              {statementTotals[account.id]
                ? String(statementTotals[account.id].total)
                : 'Unavailable'}
            </Text>
            {screen === 'contributions' && permissions.includes('financial:write') && (
              <>
                <Field
                  label="Contribution amount (SLE)"
                  value={contributionAmounts[account.id] ?? ''}
                  onChangeText={(value) =>
                    setContributionAmounts((values) => ({ ...values, [account.id]: value }))
                  }
                  keyboardType="decimal-pad"
                />
                <Field
                  label="Description (optional)"
                  value={contributionDescriptions[account.id] ?? ''}
                  onChangeText={(value) =>
                    setContributionDescriptions((values) => ({ ...values, [account.id]: value }))
                  }
                />
                <Text style={styles.detail}>Payment method</Text>
                <View style={styles.attendanceOptions}>{['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CARD', 'OTHER'].map((method) => <Pressable key={method} accessibilityRole="radio" accessibilityLabel={method.replaceAll('_', ' ')} accessibilityState={{ checked: (contributionMethods[account.id] ?? 'MOBILE_MONEY') === method, disabled: submitting }} disabled={submitting} style={styles.secondaryButton} onPress={() => setContributionMethods((values) => ({ ...values, [account.id]: method }))}><Text style={styles.secondaryText}>{(contributionMethods[account.id] ?? 'MOBILE_MONEY') === method ? '● ' : '○ '}{method.replaceAll('_', ' ')}</Text></Pressable>)}</View>
                <Pressable
                  accessibilityRole="button"
                  style={[styles.primaryButton, submitting && styles.disabled]}
                  disabled={submitting || account.status !== 'ACTIVE'}
                  onPress={() => void recordContribution(account)}
                >
                  <Text style={styles.primaryText}>
                    {submitting ? 'Recording...' : 'Record contribution'}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        ))}
        {screen === 'savings' ? (
          <Pressable
            accessibilityRole="button"
            style={styles.secondaryButton}
            onPress={() => setScreen('contributions')}
          >
            <Text style={styles.secondaryText}>View contributions</Text>
          </Pressable>
        ) : (
          <>
            <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
              Search and filter statement
            </Text>
            <Field
              label="Search reference or description"
              value={historySearch}
              onChangeText={setHistorySearch}
            />
            <DateField
              label="From date"
              value={historyFrom}
              onChangeText={setHistoryFrom}
            />
            <DateField label="To date" value={historyTo} onChangeText={setHistoryTo} />
            <Pressable
              accessibilityRole="button"
              style={styles.secondaryButton}
              onPress={() => void loadSavings(1, false, false)}
            >
              <Text style={styles.secondaryText}>Apply filters</Text>
            </Pressable>
            <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
              Contribution history
            </Text>
            {!savingsLoading && contributions.length === 0 && (
              <Text style={styles.detail}>No contributions recorded.</Text>
            )}
            {contributions.map((item) => (
              <View key={item.id} style={styles.historyItem}>
                <Text style={styles.groupName}>SLE {String(item.amount)}</Text>
                <Text style={styles.detail}>
                  {new Date(item.contributionDate).toLocaleDateString()} ·{' '}
                  {item.paymentMethod.replace('_', ' ')}
                </Text>
                <Text style={styles.groupMeta}>
                  {item.reference}
                  {item.description ? ` · ${item.description}` : ''}
                </Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    );

  if (['payContribution','payRepayment','reviewRequests'].includes(screen) && session)
    return <PaymentWorkflow token={session.accessToken} canManageLoans={permissions.includes('loans:manage')} mode={screen === 'reviewRequests' ? 'REVIEW' : screen === 'payRepayment' ? 'REPAYMENT' : 'CONTRIBUTION'} initialEmail={session.user.email} onBack={() => { void loadWorkflowSummary(); setScreen('dashboard'); }} onChanged={() => { void loadWorkflowSummary(); }} onApplyLoan={() => setScreen('loanApplication')} />;

  if (screen === 'loans' && session)
    return (
      <LoanDashboard
        loans={loans}
        repayments={repayments}
        applications={loanApplications}
        loading={loansLoading}
        refreshing={refreshing}
        onRefresh={() => void refreshScreen()}
        onHome={() => setScreen('dashboard')}
        onLoans={() => void loadLoans()}
        onBack={() => setScreen('profile')}
        onSavings={permissions.includes('financial:read') ? () => void loadSavings() : undefined}
        onActivity={
          permissions.includes('financial:read') ? () => void loadTransactions() : undefined
        }
        onApply={
          permissions.includes('financial:write') ? () => setScreen('loanApplication') : undefined
        }
        onRepay={
          permissions.includes('financial:write') ? () => setScreen(session.user.role === 'MEMBER' ? 'payRepayment' : 'repayments') : undefined
        }
        onHistory={() => setScreen('repayments')}
        onDetails={(id) => {
          const loan = loans.find((item) => item.id === id);
          if (loan) {
            setSelectedLoan(loan);
            setScreen('loanDetails');
          }
        }}
        onLoadMore={canLoadMore ? () => void loadNextPage() : undefined}
        loadingMore={loadingMore}
      />
    );

  if (['loanApplication', 'loanDetails', 'repayments'].includes(screen) && session)
    return (
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>Rural Microfinance</Text>
        <Text accessibilityRole="header" aria-level={1} style={styles.title}>
          {screen === 'loanApplication'
            ? 'Loan application'
            : screen === 'loanDetails'
              ? 'Loan details'
              : screen === 'repayments'
                ? 'Repayments'
                : 'Loans'}
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => setScreen('profile')}
        >
          <Text style={styles.secondaryText}>Back to profile</Text>
        </Pressable>
        {loansLoading && (
          <ActivityIndicator
            accessibilityLabel="Loading"
            size="large"
            color="#0F766E"
            style={styles.loader}
          />
        )}
        {screen === 'loanApplication' && (
          <>
            <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
              New application
            </Text>
            <Field label="Member ID" value={memberId} onChangeText={setMemberId} />
            <Field
              label="Loan amount (SLE)"
              value={loanAmount}
              onChangeText={setLoanAmount}
              keyboardType="decimal-pad"
            />
            <Field label="Purpose" value={loanPurpose} onChangeText={setLoanPurpose} />
            <Field
              label="Duration (months)"
              value={loanDuration}
              onChangeText={setLoanDuration}
              keyboardType="number-pad"
            />
            <DateField
              label="Application date (optional)"
              value={loanApplicationDate}
              onChangeText={setLoanApplicationDate}
              disabled={submitting}
            />
            <Field
              label="Supporting information (optional)"
              value={loanSupportingInformation}
              onChangeText={setLoanSupportingInformation}
            />
            <Pressable
              accessibilityRole="button"
              style={[styles.primaryButton, submitting && styles.disabled]}
              disabled={submitting}
              onPress={() => void submitLoanApplication()}
            >
              <Text style={styles.primaryText}>
                {submitting ? 'Submitting...' : 'Submit loan application'}
              </Text>
            </Pressable>
          </>
        )}
        {screen !== 'loanApplication' && (
          <>
            <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
              {screen === 'repayments' ? 'Loans to repay' : 'Created and disbursed loans'}
            </Text>
            {!loansLoading && loans.length === 0 && (
              <Text style={styles.detail}>No created loans found.</Text>
            )}
            {(screen === 'loanDetails' ? (selectedLoan ? [selectedLoan] : []) : loans).map(
              (loan) => (
                <View key={loan.id} style={styles.historyItem}>
                  <Text style={styles.groupName}>
                    {loan.loanReference} · {loan.status}
                  </Text>
                  <Text style={styles.detail}>
                    Principal: SLE {String(loan.principalAmount)} · Interest:{' '}
                    {String(loan.interestRate)}%
                  </Text>
                  <Text style={styles.detail}>
                    Outstanding: SLE {String(loan.outstandingBalance)} · {loan.termMonths} months
                  </Text>
                  <Text style={styles.groupMeta}>
                    {loan.startDate
                      ? `Start: ${new Date(loan.startDate).toLocaleDateString()}`
                      : ''}
                    {loan.dueDate ? ` · Due: ${new Date(loan.dueDate).toLocaleDateString()}` : ''}
                  </Text>
                  {screen === 'loanDetails' && (
                    <Pressable
                      accessibilityRole="button"
                      style={styles.secondaryButton}
                      onPress={() => setScreen('repayments')}
                    >
                      <Text style={styles.secondaryText}>Make a repayment</Text>
                    </Pressable>
                  )}
                  {screen === 'repayments' &&
                    permissions.includes('financial:write') &&
                    session.user.role !== 'MEMBER' &&
                    loan.status === 'ACTIVE' &&
                    Number(loan.outstandingBalance) > 0 && (
                      <>
                        <Field
                          label={`Repayment amount (SLE) · max ${String(loan.outstandingBalance)}`}
                          value={repaymentAmounts[loan.id] ?? ''}
                          onChangeText={(value) =>
                            setRepaymentAmounts((values) => ({ ...values, [loan.id]: value }))
                          }
                          keyboardType="decimal-pad"
                        />
                        <Pressable
                          accessibilityRole="button"
                          style={[styles.primaryButton, submitting && styles.disabled]}
                          disabled={submitting}
                          onPress={() => void submitRepayment(loan)}
                        >
                          <Text style={styles.primaryText}>
                            {submitting ? 'Recording...' : 'Record repayment'}
                          </Text>
                        </Pressable>
                      </>
                    )}
                </View>
              ),
            )}
          </>
        )}
        {screen === 'repayments' && (
          <>
            <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
              Repayment history and due dates
            </Text>
            {!loansLoading && repayments.length === 0 && (
              <Text style={styles.detail}>No repayments recorded.</Text>
            )}
            {repayments.map((repayment) => (
              <View key={repayment.id} style={styles.historyItem}>
                <Text style={styles.groupName}>
                  SLE {String(repayment.amount)} · {repayment.status}
                </Text>
                <Text style={styles.detail}>
                  {repayment.loan.loanReference} · {new Date(repayment.paidAt).toLocaleDateString()}
                </Text>
                <Text style={styles.groupMeta}>
                  Remaining: SLE {String(repayment.loan.outstandingBalance)}
                  {repayment.loan.dueDate
                    ? ` · Due: ${new Date(repayment.loan.dueDate).toLocaleDateString()}`
                    : ''}{' '}
                  · Loan status: {repayment.loan.status}
                </Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    );

  if (screen === 'groups' && session)
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.brand}>Rural Microfinance</Text>
        <Text accessibilityRole="header" aria-level={1} style={styles.title}>
          Community groups
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => setScreen('profile')}
        >
          <Text style={styles.secondaryText}>Back to profile</Text>
        </Pressable>
        {groupsLoading && (
          <ActivityIndicator
            accessibilityLabel="Loading"
            size="large"
            color="#0F766E"
            style={styles.loader}
          />
        )}
        {!groupsLoading && groups.length === 0 && (
          <Text style={styles.detail}>No active community groups found.</Text>
        )}
        {groups.map((group) => (
          <Pressable
            accessibilityRole="button"
            key={group.id}
            style={styles.groupCard}
            onPress={() => void openGroup(group)}
          >
            <Text style={styles.groupName}>{group.name}</Text>
            <Text style={styles.detail}>{group.location ?? 'Location not set'}</Text>
            <Text style={styles.groupMeta}>
              {group.manager
                ? `Administrator: ${group.manager.firstName} ${group.manager.lastName}`
                : 'Administrator not assigned'}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    );

  if (screen === 'groupDetail' && selectedGroup)
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.brand}>Rural Microfinance</Text>
        <Text accessibilityRole="header" aria-level={1} style={styles.title}>
          {selectedGroup.name}
        </Text>
        <Text style={styles.status}>{selectedGroup.status}</Text>
        <Text style={styles.detail}>Reference: {selectedGroup.registrationNo ?? 'Not set'}</Text>
        <Text style={styles.detail}>Location: {selectedGroup.location ?? 'Not set'}</Text>
        <Text style={styles.detail}>Contact: {selectedGroup.contactInfo ?? 'Not set'}</Text>
        {session && permissions.includes('groups:manage') && (['ADMIN', 'SUPER_ADMIN'].includes(session.user.role) || selectedGroup.manager?.id === session.user.id) && <GroupMemberPolicy key={selectedGroup.id} groupId={selectedGroup.id} weeklyAmount={selectedGroup.weeklyContributionAmount} withdrawalsAllowed={selectedGroup.withdrawalsAllowed} />}
        <Text style={styles.detail}>
          Administrator:{' '}
          {selectedGroup.manager
            ? `${selectedGroup.manager.firstName} ${selectedGroup.manager.lastName}`
            : 'Not assigned'}
        </Text>
        {selectedGroup.description && (
          <Text style={styles.description}>{selectedGroup.description}</Text>
        )}
        <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
          Group dashboard
        </Text>
        <View style={styles.statsGrid}>
          <Stat
            label="Members"
            value={`${selectedGroup.statistics.activeMembers}/${selectedGroup.statistics.totalMembers}`}
          />
          <Stat label="Active loans" value={`${selectedGroup.statistics.activeLoans}`} />
          <Stat
            label="Pending loans"
            value={`${selectedGroup.statistics.pendingLoanApplications}`}
          />
          <Stat label="Meetings" value={`${selectedGroup.statistics.scheduledMeetings}`} />
        </View>
        <Text style={styles.detail}>
          Total savings: SLE {String(selectedGroup.statistics.totalSavings)}
        </Text>
        <Text style={styles.detail}>
          Outstanding loans: SLE {String(selectedGroup.statistics.outstandingLoanBalance)}
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => setScreen('groups')}
        >
          <Text style={styles.secondaryText}>Back to groups</Text>
        </Pressable>
      </ScrollView>
    );

  if (screen === 'addMember' && session && permissions.includes('members:manage'))
    return (
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" aria-level={1} style={styles.title}>
          Add member
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => setScreen('dashboard')}
        >
          <Text style={styles.secondaryText}>Back to dashboard</Text>
        </Pressable>
        <Text style={styles.detail}>
          Choose an existing registered member account and its community group.
        </Text>
        {permissions.includes('users:read') ? (
          <>
            <Field
              label="Search member accounts by name, phone, or email"
              value={memberAccountSearch}
              onChangeText={setMemberAccountSearch}
            />
            <Pressable
              accessibilityRole="button"
              style={styles.secondaryButton}
              disabled={memberAccountsLoading || submitting}
              onPress={() => void searchMemberAccounts()}
            >
              <Text style={styles.secondaryText}>
                {memberAccountsLoading ? 'Searching...' : 'Search accounts'}
              </Text>
            </Pressable>
            {memberAccounts.map((account) => (
              <Pressable
                key={account.id}
                accessibilityRole="button"
                accessibilityState={{ selected: newMemberUserId === account.id }}
                disabled={submitting}
                style={styles.groupCard}
                onPress={() => setNewMemberUserId(account.id)}
              >
                <Text style={styles.groupName}>
                  {account.firstName} {account.lastName}
                  {newMemberUserId === account.id ? ' · Selected' : ''}
                </Text>
                <Text style={styles.groupMeta}>{account.phone ?? account.email}</Text>
              </Pressable>
            ))}
            <Text style={styles.detail}>
              Search to find an active member account. Accounts already assigned to a group cannot
              be added again.
            </Text>
          </>
        ) : (
          <Field
            label="Registered member account ID"
            value={newMemberUserId}
            onChangeText={setNewMemberUserId}
          />
        )}
        <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
          Community group
        </Text>
        {groupsLoading && <ActivityIndicator accessibilityLabel="Loading groups" color="#0F766E" />}
        {groups.map((group) => (
          <Pressable
            key={group.id}
            accessibilityRole="button"
            accessibilityState={{ selected: newMemberGroupId === group.id }}
            disabled={submitting}
            style={styles.groupCard}
            onPress={() => setNewMemberGroupId(group.id)}
          >
            <Text style={styles.groupName}>
              {dashboardGroupName(group.name)}
              {newMemberGroupId === group.id ? ' · Selected' : ''}
            </Text>
            <Text style={styles.groupMeta}>{group.location}</Text>
          </Pressable>
        ))}
        {pageInfo.groups &&
          pageInfo.groups.page * pageInfo.groups.limit < pageInfo.groups.total && (
            <Pressable
              accessibilityRole="button"
              style={styles.secondaryButton}
              disabled={groupsLoading || submitting}
              onPress={() => void loadGroups(pageInfo.groups.page + 1, true)}
            >
              <Text style={styles.secondaryText}>Load more groups</Text>
            </Pressable>
          )}
        {!groupsLoading && groups.length === 0 && (
          <Text style={styles.detail}>
            No active community groups are available. A member must be assigned to an active group.
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          style={styles.primaryButton}
          disabled={submitting || !newMemberUserId || !newMemberGroupId}
          onPress={() => void submitMember()}
        >
          <Text style={styles.primaryText}>
            {submitting ? 'Adding member...' : 'Confirm add member'}
          </Text>
        </Pressable>
      </ScrollView>
    );

  if (screen === 'members' && session)
    return (
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>Rural Microfinance</Text>
        <Text accessibilityRole="header" aria-level={1} style={styles.title}>
          Member directory
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => setScreen('dashboard')}
        >
          <Text style={styles.secondaryText}>Back to dashboard</Text>
        </Pressable>
        <Field
          label="Search name, phone, email, or member number"
          value={memberSearch}
          onChangeText={setMemberSearch}
        />
        <Field label="Group ID (optional)" value={memberGroupId} onChangeText={setMemberGroupId} />
        <Pressable
          accessibilityRole="button"
          style={styles.primaryButton}
          onPress={() => void loadMembers()}
        >
          <Text style={styles.primaryText}>Search members</Text>
        </Pressable>
        {membersLoading && (
          <ActivityIndicator
            accessibilityLabel="Loading"
            size="large"
            color="#0F766E"
            style={styles.loader}
          />
        )}
        {!membersLoading && members.length === 0 && (
          <Text style={styles.detail}>No members were returned for this account and filter.</Text>
        )}
        {members.map((member) => (
          <Pressable
            accessibilityRole="button"
            key={member.id}
            style={styles.historyItem}
            onPress={() => void openMember(member)}
          >
            <Text style={styles.groupName}>
              {member.user.firstName} {member.user.lastName}
            </Text>
            <Text style={styles.detail}>
              {member.memberNumber} · {member.status}
            </Text>
            <Text style={styles.groupMeta}>
              {member.group.name} · {member.group.location}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    );

  if (screen === 'memberDetail' && selectedMember)
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.brand}>Rural Microfinance</Text>
        <Text accessibilityRole="header" aria-level={1} style={styles.title}>
          Member details
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => setScreen('members')}
        >
          <Text style={styles.secondaryText}>Back to members</Text>
        </Pressable>
        <View style={styles.groupCard}>
          <Text style={styles.groupName}>
            {selectedMember.user.firstName} {selectedMember.user.lastName}
          </Text>
          <Text style={styles.detail}>
            {selectedMember.memberNumber} · {selectedMember.status}
          </Text>
          <Text style={styles.detail}>Group: {selectedMember.group.name}</Text>
          <Text style={styles.detail}>
            Joined: {new Date(selectedMember.joinedAt).toLocaleDateString()}
          </Text>
          <Text style={styles.detail}>Email: {selectedMember.user.email ?? 'Not provided'}</Text>
          <Text style={styles.detail}>Phone: {selectedMember.user.phone ?? 'Not provided'}</Text>
          <Text style={styles.detail}>
            Savings balance: SLE{' '}
            {selectedMember.savingsBalance == null
              ? 'Unavailable'
              : String(selectedMember.savingsBalance)}
          </Text>
          <Text style={styles.detail}>
            Active loan balance: SLE{' '}
            {selectedMember.loanBalance == null
              ? 'Unavailable'
              : String(selectedMember.loanBalance)}
          </Text>
        </View>
      </ScrollView>
    );

  if (screen === 'transactions' && session)
    return (
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>Rural Microfinance</Text>
        <Text accessibilityRole="header" aria-level={1} style={styles.title}>
          Transaction history
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => setScreen('dashboard')}
        >
          <Text style={styles.secondaryText}>Back to dashboard</Text>
        </Pressable>
        <Field
          label="Search reference or description"
          value={transactionSearch}
          onChangeText={setTransactionSearch}
        />
        <Field
          label="Type (CONTRIBUTION, LOAN_REPAYMENT, etc.)"
          value={transactionType}
          onChangeText={setTransactionType}
        />
        <Field
          label="Status (COMPLETED, PENDING, FAILED, REVERSED)"
          value={transactionStatus}
          onChangeText={setTransactionStatus}
        />
        <DateField
          label="From date"
          value={transactionFrom}
          onChangeText={setTransactionFrom}
        />
        <DateField label="To date" value={transactionTo} onChangeText={setTransactionTo} />
        <Pressable
          accessibilityRole="button"
          style={styles.primaryButton}
          onPress={() => void loadTransactions()}
        >
          <Text style={styles.primaryText}>Apply filters</Text>
        </Pressable>
        {transactionsLoading && (
          <ActivityIndicator
            accessibilityLabel="Loading"
            size="large"
            color="#0F766E"
            style={styles.loader}
          />
        )}
        {!transactionsLoading && transactions.length === 0 && (
          <Text style={styles.detail}>
            No financial records were returned for this account and filter.
          </Text>
        )}
        {transactions.map((item) => (
          <View key={item.id} style={styles.historyItem}>
            <Text style={styles.groupName}>
              {item.type.replaceAll('_', ' ')} · {item.status}
            </Text>
            <Text style={styles.detail}>
              SLE {String(item.amount)} · {item.reference}
            </Text>
            <Text style={styles.groupMeta}>
              {new Date(item.occurredAt).toLocaleString()} · {item.group?.name ?? 'No group'}
              {item.groupMember
                ? ` · ${item.groupMember.user.firstName} ${item.groupMember.user.lastName}`
                : ''}
            </Text>
            {item.description && <Text style={styles.groupMeta}>{item.description}</Text>}
            {item.blockchainStatus && (
              <Text style={styles.groupMeta}>
                Blockchain: {item.blockchainStatus}
                {item.blockchainHash ? ` · ${item.blockchainHash}` : ''}
              </Text>
            )}
            {permissions.includes('financial:read') && (
              <Pressable
                accessibilityRole="button"
                style={styles.smallButton}
                onPress={() => {
                  setTransactionIdInput(item.id);
                  void loadBlockchain();
                }}
              >
                <Text style={styles.secondaryText}>Verify record</Text>
              </Pressable>
            )}
          </View>
        ))}
      </ScrollView>
    );

  if (screen === 'reports' && session)
    return (
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>Rural Microfinance</Text>
        <Text accessibilityRole="header" aria-level={1} style={styles.title}>
          Reports and analytics
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => setScreen('dashboard')}
        >
          <Text style={styles.secondaryText}>Back to dashboard</Text>
        </Pressable>
        <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
          Filters
        </Text>
        <DateField label="From date" value={reportFrom} onChangeText={setReportFrom} />
        <DateField label="To date" value={reportTo} onChangeText={setReportTo} />
        <Field
          label="Group ID (optional UUID)"
          value={reportGroupId}
          onChangeText={setReportGroupId}
        />
        <Field
          label="Member ID (optional UUID)"
          value={reportMemberId}
          onChangeText={setReportMemberId}
        />
        <Field
          label="Transaction type (optional)"
          value={reportTransactionType}
          onChangeText={setReportTransactionType}
        />
        <Field
          label="Loan status (optional)"
          value={reportLoanStatus}
          onChangeText={setReportLoanStatus}
        />
        <Pressable
          accessibilityRole="button"
          style={[styles.primaryButton, reportsLoading && styles.disabled]}
          disabled={reportsLoading}
          onPress={() => void loadReports()}
        >
          <Text style={styles.primaryText}>
            {reportsLoading ? 'Loading report...' : 'Run report'}
          </Text>
        </Pressable>
        {reportsLoading && (
          <ActivityIndicator
            accessibilityLabel="Loading"
            size="large"
            color="#0F766E"
            style={styles.loader}
          />
        )}
        {report && (
          <>
            <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
              Members
            </Text>
            <View style={styles.statsGrid}>
              <Stat label="Total" value={String(report.members.totalMembers)} />
              <Stat label="Active" value={String(report.members.activeMembers)} />
              <Stat label="Inactive" value={String(report.members.inactiveMembers)} />
            </View>
            <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
              Savings
            </Text>
            <View style={styles.statsGrid}>
              <Stat label="Total balance" value={`SLE ${String(report.savings.totalSavings)}`} />
            </View>
            {report.savings.monthlyContributions.map((item) => (
              <View key={`contrib-${item.month}`} style={styles.historyItem}>
                <Text style={styles.groupName}>{item.month}</Text>
                <Text style={styles.detail}>Contributions: SLE {String(item.total)}</Text>
              </View>
            ))}
            <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
              Member savings
            </Text>
            {report.savings.memberSavings.length === 0 ? (
              <Text style={styles.detail}>No member savings found for these filters.</Text>
            ) : (
              report.savings.memberSavings.map((item) => (
                <View key={item.memberId} style={styles.historyItem}>
                  <Text style={styles.groupName}>
                    {item.name} · {item.memberNumber}
                  </Text>
                  <Text style={styles.groupMeta}>{item.groupName}</Text>
                  <Text style={styles.detail}>Balance: SLE {String(item.savings)}</Text>
                </View>
              ))
            )}
            <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
              Loans
            </Text>
            <View style={styles.statsGrid}>
              <Stat label="Total" value={String(report.loans.totalLoans)} />
              <Stat label="Approved" value={String(report.loans.approvedLoans)} />
              <Stat label="Rejected" value={String(report.loans.rejectedLoans)} />
              <Stat label="Active" value={String(report.loans.activeLoans)} />
              <Stat label="Completed" value={String(report.loans.completedLoans)} />
              <Stat label="Defaulted" value={String(report.loans.defaultedLoans)} />
              <Stat label="Outstanding" value={`SLE ${String(report.loans.outstandingBalance)}`} />
            </View>
            <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
              Repayments
            </Text>
            <View style={styles.statsGrid}>
              <Stat label="Total" value={`SLE ${String(report.repayments.totalRepayments)}`} />
              <Stat
                label="Outstanding"
                value={`SLE ${String(report.repayments.outstandingRepayments)}`}
              />
            </View>
            {report.repayments.monthlyRepayments.map((item) => (
              <View key={`repayment-${item.month}`} style={styles.historyItem}>
                <Text style={styles.groupName}>{item.month}</Text>
                <Text style={styles.detail}>Repayments: SLE {String(item.total)}</Text>
              </View>
            ))}
            <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
              Blockchain
            </Text>
            <View style={styles.statsGrid}>
              <Stat label="Total" value={String(report.blockchain.totalTransactions)} />
              <Stat label="Verified" value={String(report.blockchain.verifiedTransactions)} />
              <Stat label="Pending" value={String(report.blockchain.pendingTransactions)} />
              <Stat label="Failed" value={String(report.blockchain.failedTransactions)} />
            </View>
          </>
        )}
        {!reportsLoading && !report && (
          <Text style={styles.detail}>Run a report to load analytics from the server.</Text>
        )}
      </ScrollView>
    );

  if (screen === 'blockchain' && session)
    return (
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>Rural Microfinance</Text>
        <Text accessibilityRole="header" aria-level={1} style={styles.title}>
          Blockchain verification
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => setScreen('dashboard')}
        >
          <Text style={styles.secondaryText}>Back to dashboard</Text>
        </Pressable>
        {blockchainLoading && (
          <ActivityIndicator
            accessibilityLabel="Loading"
            size="large"
            color="#0F766E"
            style={styles.loader}
          />
        )}
        {blockchainStatus ? (
          <Text style={styles.status}>
            Blockchain integration: {blockchainStatus.configured ? 'Configured' : 'Not configured'}
          </Text>
        ) : (
          <Text style={styles.detail}>Network status is not available for this role.</Text>
        )}
        {permissions.includes('financial:read') && (
          <>
            <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
              Verify a financial record
            </Text>
            <Field
              label="Transaction UUID"
              value={transactionIdInput}
              onChangeText={setTransactionIdInput}
            />
            <Pressable
              accessibilityRole="button"
              style={[styles.primaryButton, blockchainLoading && styles.disabled]}
              disabled={blockchainLoading}
              onPress={() => void verifyTransaction()}
            >
              <Text style={styles.primaryText}>Verify transaction</Text>
            </Pressable>
            {blockchainResult && (
              <View style={styles.historyItem}>
                <Text style={styles.groupName}>
                  Result: {blockchainResult.verificationResult.replaceAll('_', ' ')}
                </Text>
                <Text style={styles.groupMeta}>
                  Reference: {blockchainResult.transactionReference}
                </Text>
                <Text style={styles.groupMeta}>Database hash: {blockchainResult.databaseHash}</Text>
                <Text style={styles.groupMeta}>
                  Chain hash: {blockchainResult.blockchainHash ?? 'Not recorded'}
                </Text>
                <Text style={styles.groupMeta}>
                  Transaction hash: {blockchainResult.blockchainTransactionHash ?? 'Not recorded'}
                </Text>
                {blockchainResult.timestamp && (
                  <Text style={styles.groupMeta}>
                    Verified: {new Date(blockchainResult.timestamp).toLocaleString()}
                  </Text>
                )}
              </View>
            )}
            <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
              Verify a proof reference
            </Text>
            <Field
              label="Proof reference"
              value={proofReferenceInput}
              onChangeText={setProofReferenceInput}
            />
            <Field
              label="Expected record hash"
              value={expectedHashInput}
              onChangeText={setExpectedHashInput}
            />
            <Pressable
              accessibilityRole="button"
              style={[styles.primaryButton, blockchainLoading && styles.disabled]}
              disabled={blockchainLoading}
              onPress={() => void verifyProof()}
            >
              <Text style={styles.primaryText}>Verify proof</Text>
            </Pressable>
            {proofResult && (
              <View style={styles.historyItem}>
                <Text style={styles.groupName}>
                  Proof {proofResult.verified ? 'verified' : 'does not match'}
                </Text>
                <Text style={styles.groupMeta}>Transaction: {proofResult.transactionHash}</Text>
                <Text style={styles.groupMeta}>Block: {proofResult.blockNumber}</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    );

  if (screen === 'settings' && session)
    return (
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>Rural Microfinance</Text>
        <Text accessibilityRole="header" aria-level={1} style={styles.title}>
          Settings
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => setScreen('dashboard')}
        >
          <Text style={styles.secondaryText}>Back to dashboard</Text>
        </Pressable>
        <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
          Account and help
        </Text>
        {settingsLoading && (
          <ActivityIndicator accessibilityLabel="Loading account settings" color="#0F766E" />
        )}
        {profile && (
          <Text style={styles.detail}>
            {profile.firstName} {profile.lastName} ? {profile.status}
          </Text>
        )}
        <Text style={styles.detail}>
          Amounts are shown in Sierra Leone leones (SLE). Use your phone settings to increase text size.
          Pull down to refresh, or use Retry after a connection error.
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => setScreen('profile')}
        >
          <Text style={styles.secondaryText}>Edit my profile</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => void logout()}
        >
          <Text style={styles.secondaryText}>Sign out</Text>
        </Pressable>
        {permissions.includes('settings:manage') && (
          <>
            <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
              System settings
            </Text>
            {settingsLoading && (
              <ActivityIndicator
                accessibilityLabel="Loading"
                size="large"
                color="#0F766E"
                style={styles.loader}
              />
            )}
            {!settingsLoading && settings.length === 0 && (
              <Text style={styles.detail}>No system settings were returned by the server.</Text>
            )}
            {settings.map((setting) => (
              <Pressable
                accessibilityRole="button"
                key={setting.id}
                style={styles.historyItem}
                onPress={() => editSetting(setting)}
              >
                <Text style={styles.groupName}>{setting.key}</Text>
                <Text style={styles.groupMeta}>{JSON.stringify(setting.value)}</Text>
                <Text style={styles.groupMeta}>
                  Updated {new Date(setting.updatedAt).toLocaleString()}
                </Text>
              </Pressable>
            ))}
            <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
              {settingKey ? `Edit ${settingKey}` : 'Select a setting to edit'}
            </Text>
            {settingKey ? (
              <>
                <Field
                  label="Setting value (JSON object)"
                  value={settingValue}
                  onChangeText={setSettingValue}
                  multiline
                />
                <Pressable
                  accessibilityRole="button"
                  style={[styles.primaryButton, submitting && styles.disabled]}
                  disabled={submitting}
                  onPress={() => void saveSetting()}
                >
                  <Text style={styles.primaryText}>
                    {submitting ? 'Saving...' : 'Save setting'}
                  </Text>
                </Pressable>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    );

  const isRegister = screen === 'register';
  const isForgot = screen === 'forgot';
  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.brand}>Rural Microfinance</Text>
      <Text accessibilityRole="header" aria-level={1} style={styles.title}>
        {isRegister ? 'Create your account' : isForgot ? 'Reset password' : 'Welcome back'}
      </Text>
      {isRegister && (
        <>
          <Field label="Member ID (required, e.g. 2026001)" value={memberId} onChangeText={setMemberId} error={formErrors.memberId} />
          <Field
            label="First name"
            error={isRegister ? formErrors.firstName : undefined}
            value={firstName}
            onChangeText={setFirstName}
          />
          <Field
            label="Last name"
            error={isRegister ? formErrors.lastName : undefined}
            value={lastName}
            onChangeText={setLastName}
          />
          <Field
            label="Email address"
            error={isRegister ? formErrors.email : undefined}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
          />
          <Field
            label="Phone number"
            error={isRegister ? formErrors.phone : undefined}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          <Text style={styles.label}>Role</Text>
          <RoleDropdown value={role} disabled={submitting} onChange={(value) => { setRole(value); setGroupId(''); }} />
          {role !== 'MEMBER' && <Text style={styles.detail}>An existing administrator must approve this account before you can sign in.</Text>}
          {role === 'MEMBER' && (
            <>
              <Text style={styles.label}>Community group</Text>
              {registrationGroups.map((group) => <Pressable key={group.id} accessibilityRole="button" onPress={() => setGroupId(group.id)} style={styles.secondaryButton}><Text style={styles.secondaryText}>{dashboardGroupName(group.name)}{groupId === group.id ? ' · Selected' : ''}</Text></Pressable>)}
              <Text style={styles.detail}>Join a community to pay contributions and apply for loans. A manager can assign your account later.</Text>
            </>
          )}
        </>
      )}
      {!isRegister && (
        <Field
          label={isForgot ? 'Email address or phone number' : 'Member ID, email address or phone number'}
          value={identifier}
          onChangeText={setIdentifier}
          keyboardType="email-address"
        />
      )}
      {!isForgot && (
        <Field
          label="Password"
          error={isRegister ? formErrors.password : undefined}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
      )}
      {isRegister && (
        <Field
          label="Confirm password"
          error={isRegister ? formErrors.confirmation : undefined}
          value={confirmation}
          onChangeText={setConfirmation}
          secureTextEntry
        />
      )}
      <Pressable
        accessibilityRole="button"
        style={[styles.primaryButton, submitting && styles.disabled]}
        disabled={submitting}
        onPress={() =>
          void (isRegister ? submitRegistration() : isForgot ? submitForgot() : submitLogin())
        }
      >
        <Text style={styles.primaryText}>
          {submitting
            ? 'Please wait...'
            : isRegister
              ? 'Create account'
              : isForgot
                ? 'Send reset instructions'
                : 'Sign in'}
        </Text>
      </Pressable>
      {!isRegister && !isForgot && (
        <>
          {Platform.OS === 'android' && (
            <>
              <GoogleSignInButton disabled={submitting} onPress={() => void submitGoogleLogin()} />
              <Text style={styles.detail}>Use the Google email registered on your member account.</Text>
            </>
          )}
          <WalletAuth onSession={saveSession} onBusyChange={setSubmitting} disabled={submitting} />
          <Pressable accessibilityRole="button" onPress={() => setScreen('forgot')}>
            <Text style={styles.link}>Forgot password?</Text>
          </Pressable>
        </>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={() => setScreen(isRegister || isForgot ? 'login' : 'register')}
      >
        <Text style={styles.link}>
          {isRegister
            ? 'Already have an account? Sign in'
            : isForgot
              ? 'Back to sign in'
              : 'New here? Create an account'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  error?: string;
  secureTextEntry?: boolean;
  multiline?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'decimal-pad' | 'number-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        accessibilityLabel={props.label}
        accessibilityHint={props.error}
        style={[
          styles.input,
          props.error && { borderColor: '#B91C1C' },
          props.multiline && styles.multilineInput,
        ]}
        value={props.value}
        onChangeText={props.onChangeText}
        secureTextEntry={props.secureTextEntry}
        multiline={props.multiline}
        textAlignVertical={props.multiline ? 'top' : 'center'}
        keyboardType={props.keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {props.error && (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: '#B91C1C', fontSize: 14, marginTop: 6 }}
        >
          {props.error}
        </Text>
      )}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function AdminDashboardPanel({
  data,
  loading,
  error,
  onRetry,
}: {
  data: AdminDashboardData | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading && !data)
    return (
      <ActivityIndicator
        accessibilityLabel="Loading"
        size="large"
        color="#0F766E"
        style={styles.loader}
      />
    );
  if (error && !data)
    return (
      <View style={styles.historyItem}>
        <Text style={styles.detail}>{error}</Text>
        <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={onRetry}>
          <Text style={styles.secondaryText}>Retry dashboard</Text>
        </Pressable>
      </View>
    );
  if (!data) return <Text style={styles.detail}>Dashboard data is not available.</Text>;

  const metrics = [
    { label: 'Total users', value: data.metrics.totalUsers.toLocaleString() },
    { label: 'Total groups', value: data.metrics.totalGroups.toLocaleString() },
    { label: 'Total members', value: data.metrics.totalMembers.toLocaleString() },
    { label: 'Total savings', value: formatDashboardCurrency(data.metrics.totalSavings) },
    { label: 'Total loans', value: data.metrics.totalLoans.toLocaleString() },
    { label: 'Outstanding loans', value: formatDashboardCurrency(data.metrics.outstandingLoans) },
    { label: 'Total repayments', value: formatDashboardCurrency(data.metrics.totalRepayments) },
  ];

  return (
    <>
      <View style={styles.statsGrid}>
        {metrics.map((item) => (
          <Stat key={item.label} label={item.label} value={item.value} />
        ))}
      </View>

      <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
        Savings and repayments · 6 months
      </Text>
      <MonthlyFlowChart
        savings={data.charts.savingsTrend}
        repayments={data.charts.repaymentTrend}
      />

      <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
        Loan status
      </Text>
      <StatusBarList items={data.charts.loanStatus} color="#0F766E" />
      <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
        Blockchain status
      </Text>
      <StatusBarList items={data.charts.blockchainStatus} color="#2563EB" />

      <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
        Recent transactions
      </Text>
      {data.recentTransactions.length === 0 ? (
        <Text style={styles.detail}>No transactions recorded.</Text>
      ) : (
        data.recentTransactions.slice(0, 4).map((item) => (
          <View key={item.id} style={styles.historyItem}>
            <View style={styles.dashboardListHeader}>
              <Text style={styles.groupName}>{item.type.replaceAll('_', ' ')}</Text>
              <Text style={styles.dashboardAmount}>{formatDashboardCurrency(item.amount)}</Text>
            </View>
            <Text style={styles.groupMeta}>
              {item.reference} · {item.status}
            </Text>
            <Text style={styles.groupMeta}>
              <Text style={{ fontWeight: '700' }}>
                {dashboardGroupName(item.groupName ?? 'No group')}
              </Text>
              {item.member ? ` · ${item.member}` : ''} ·{' '}
              {new Date(item.occurredAt).toLocaleDateString()}
            </Text>
          </View>
        ))
      )}

      <View style={styles.dashboardSectionHeader}>
        <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
          Pending applications
        </Text>
        <Text style={styles.dashboardCount}>{data.metrics.pendingApplications}</Text>
      </View>
      {data.pendingApplications.length === 0 ? (
        <Text style={styles.detail}>No applications awaiting review.</Text>
      ) : (
        data.pendingApplications.slice(0, 3).map((item) => (
          <View key={item.id} style={styles.historyItem}>
            <View style={styles.dashboardListHeader}>
              <Text style={styles.groupName}>
                {item.member ?? 'Member'} · {formatDashboardCurrency(item.requestedAmount)}
              </Text>
              <Text style={styles.dashboardStatus}>{item.status.replaceAll('_', ' ')}</Text>
            </View>
            <Text style={styles.groupMeta}>
              <Text style={{ fontWeight: '700' }}>
                {dashboardGroupName(item.groupName ?? 'No group')}
              </Text>{' '}
              ·{' '}
              {item.submittedAt ? new Date(item.submittedAt).toLocaleDateString() : 'Not submitted'}
            </Text>
            <Text style={styles.detail}>{item.purpose}</Text>
          </View>
        ))
      )}

      <View style={styles.dashboardSectionHeader}>
        <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
          Notifications
        </Text>
        <Text style={styles.dashboardCount}>{data.metrics.unreadNotifications} unread</Text>
      </View>
      {data.notifications.length === 0 ? (
        <Text style={styles.detail}>No notifications.</Text>
      ) : (
        data.notifications.slice(0, 3).map((item) => (
          <View key={item.id} style={styles.historyItem}>
            <Text style={styles.groupName}>{item.title}</Text>
            <Text style={styles.detail}>{item.message}</Text>
            <Text style={styles.groupMeta}>
              {item.type} · {new Date(item.createdAt).toLocaleDateString()} · {item.status}
            </Text>
          </View>
        ))
      )}
    </>
  );
}

function MonthlyFlowChart({
  savings,
  repayments,
}: {
  savings: AdminDashboardData['charts']['savingsTrend'];
  repayments: AdminDashboardData['charts']['repaymentTrend'];
}) {
  const months = savings.map((item) => ({
    month: item.month,
    savings: item.value,
    repayments: repayments.find((entry) => entry.month === item.month)?.value ?? 0,
  }));
  const maximum = Math.max(1, ...months.flatMap((item) => [item.savings, item.repayments]));

  return (
    <View style={styles.chartPanel}>
      <View style={styles.chartLegend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, styles.savingsSwatch]} />
          <Text style={styles.groupMeta}>Savings</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, styles.repaymentSwatch]} />
          <Text style={styles.groupMeta}>Repayments</Text>
        </View>
      </View>
      <View style={styles.monthChart}>
        {months.map((item) => (
          <View key={item.month} style={styles.monthColumn}>
            <View style={styles.monthBars}>
              <View
                style={[
                  styles.monthBar,
                  styles.savingsBar,
                  { height: item.savings ? Math.max(4, (item.savings / maximum) * 96) : 0 },
                ]}
              />
              <View
                style={[
                  styles.monthBar,
                  styles.repaymentBar,
                  { height: item.repayments ? Math.max(4, (item.repayments / maximum) * 96) : 0 },
                ]}
              />
            </View>
            <Text style={styles.monthLabel}>
              {new Date(`${item.month}-01T00:00:00`).toLocaleDateString(undefined, {
                month: 'short',
              })}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function StatusBarList({
  items,
  color,
}: {
  items: AdminDashboardData['charts']['loanStatus'];
  color: string;
}) {
  const maximum = Math.max(1, ...items.map((item) => item.value));
  return (
    <View>
      {items.map((item) => (
        <View key={item.status} style={styles.statusChartRow}>
          <View style={styles.statusChartLabel}>
            <Text style={styles.groupMeta}>{item.status.replaceAll('_', ' ')}</Text>
            <Text style={styles.groupMeta}>{item.value.toLocaleString()}</Text>
          </View>
          <View style={styles.statusTrack}>
            <View
              style={[
                styles.statusFill,
                { backgroundColor: color, width: `${(item.value / maximum) * 100}%` },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

function formatDashboardCurrency(value: number) {
  return formatSle(value);
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    backgroundColor: '#F0FDFA',
    padding: 24,
    justifyContent: 'flex-start',
  },
  center: {
    flex: 1,
    backgroundColor: '#F0FDFA',
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashContainer: {
    flex: 1,
    backgroundColor: '#003D32',
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashImage: { width: '100%', height: '100%' },
  splashSpinner: { position: 'absolute', bottom: 24 },
  onboardingContainer: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    backgroundColor: '#F0FDFA',
    padding: 24,
    justifyContent: 'center',
  },
  onboardingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1.5,
    marginBottom: 20,
  },
  onboardingIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  onboardingIconText: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
  dotRow: { flexDirection: 'row', justifyContent: 'center', marginVertical: 20 },
  dot: { width: 10, height: 10, borderRadius: 999, marginHorizontal: 6 },
  dotInactive: { backgroundColor: '#BFDBFE' },
  dotActive: { backgroundColor: '#0F766E' },
  dashboardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  appNav: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DCE7E5',
    borderRadius: 8,
    padding: 6,
    marginBottom: 18,
  },
  appNavButton: {
    minHeight: 48,
    flexGrow: 1,
    flexBasis: 64,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 5,
  },
  appNavButtonActive: { backgroundColor: '#DDF5EF' },
  appNavText: { color: '#475569', fontWeight: '600' },
  appNavTextActive: { color: '#0F766E' },
  smallButton: {
    minHeight: 48,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#0F766E',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  quickGrid: {
    gap: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  quickCard: {
    flexGrow: 1,
    flexBasis: 230,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
  quickTitle: { color: '#0F172A', fontWeight: '700', fontSize: 16 },
  brand: { color: '#0F766E', fontSize: 18, fontWeight: '700', marginBottom: 10 },
  title: {
    color: '#172033',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 28,
    textAlign: 'center',
  },
  detail: { color: '#475569', fontSize: 16, marginBottom: 12 },
  status: {
    color: '#0F766E',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 20,
    textAlign: 'center',
  },
  field: { marginBottom: 14 },
  label: { color: '#334155', fontSize: 14, fontWeight: '600', marginBottom: 6 },
  input: {
    minHeight: 48,
    fontSize: 16,
    paddingVertical: 10,
    borderColor: '#94A3B8',
    borderWidth: 1,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    color: '#172033',
  },
  multilineInput: { minHeight: 160, height: 200, paddingTop: 12, textAlignVertical: 'top' },
  roleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  roleOption: {
    flexGrow: 1,
    flexBasis: 140,
    padding: 8,
    minHeight: 48,
    borderColor: '#94A3B8',
    borderWidth: 1,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roleSelected: { backgroundColor: '#0F766E', borderColor: '#0F766E' },
  roleText: { color: '#334155', fontWeight: '600' },
  roleTextSelected: { color: '#FFFFFF' },
  attendanceOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  attendanceOption: {
    minWidth: 92,
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#94A3B8',
    borderRadius: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attendanceOptionSelected: { backgroundColor: '#0F766E', borderColor: '#0F766E' },
  attendanceOptionText: { color: '#334155', fontWeight: '600' },
  attendanceOptionTextSelected: { color: '#FFFFFF' },
  primaryButton: {
    minHeight: 48,
    backgroundColor: '#0F766E',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  primaryButtonLarge: { marginTop: 14 },
  primaryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  secondaryButton: {
    borderColor: '#0F766E',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  secondaryText: { color: '#0F766E', fontWeight: '700' },
  link: {
    minHeight: 48,
    paddingVertical: 12,
    color: '#0F766E',
    textAlign: 'center',
    fontWeight: '600',
    marginTop: 20,
  },
  disabled: { opacity: 0.65 },
  loader: { marginVertical: 20 },
  groupCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
  groupName: { color: '#172033', fontWeight: '700', fontSize: 18, marginBottom: 6 },
  groupMeta: { color: '#64748B', fontSize: 13 },
  description: { color: '#475569', fontSize: 14, lineHeight: 20, marginBottom: 16 },
  sectionTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 20,
    marginBottom: 8,
  },
  statsGrid: {
    gap: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  stat: {
    flexGrow: 1,
    flexBasis: 230,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
  statValue: { color: '#0F766E', fontSize: 22, fontWeight: '800' },
  statLabel: { color: '#475569', fontSize: 12, marginTop: 4 },
  chartPanel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#DCE7E5',
  },
  chartLegend: { flexDirection: 'row', gap: 18, marginBottom: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 9, height: 9, borderRadius: 2 },
  savingsSwatch: { backgroundColor: '#0F766E' },
  repaymentSwatch: { backgroundColor: '#2563EB' },
  monthChart: {
    height: 126,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderBottomWidth: 1,
    borderBottomColor: '#CBD5E1',
  },
  monthColumn: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  monthBars: {
    height: 102,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 3,
  },
  monthBar: { width: 10, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  savingsBar: { backgroundColor: '#0F766E' },
  repaymentBar: { backgroundColor: '#2563EB' },
  monthLabel: { color: '#64748B', fontSize: 10, marginTop: 5, marginBottom: 5 },
  statusChartRow: { marginBottom: 10 },
  statusChartLabel: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  statusTrack: { height: 6, backgroundColor: '#E2E8F0', borderRadius: 3, overflow: 'hidden' },
  statusFill: { height: 6, borderRadius: 3 },
  dashboardSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  dashboardCount: { color: '#0F766E', fontWeight: '700', marginTop: 16 },
  dashboardListHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  dashboardAmount: { color: '#172033', fontWeight: '700' },
  dashboardStatus: { color: '#0F766E', fontSize: 11, fontWeight: '700' },
  historyItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  unreadSummary: { color: '#0F766E', fontWeight: '700', marginBottom: 10 },
  notificationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  historyItemUnread: {
    backgroundColor: '#ECFEFF',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
  groupNameUnread: { color: '#0F172A', fontWeight: '700', fontSize: 18 },
  newBadge: {
    backgroundColor: '#0F766E',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  newBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  statusBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#ECFEFF',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusBadgeText: { color: '#065F46', fontSize: 11, fontWeight: '700' },
});
