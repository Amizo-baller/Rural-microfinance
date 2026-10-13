const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test('live database balances, authorization, reset delivery and blockchain proofs agree', async ({
  request,
}) => {
  test.setTimeout(180000);
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../../.acceptance/fixture.json')),
  );
  async function call(route, { token, method = 'GET', data, status } = {}) {
    const response = await request.fetch(fixture.apiOrigin + '/api' + route, {
      method,
      ...(data ? { data } : {}),
      ...(token ? { headers: { Authorization: 'Bearer ' + token } } : {}),
    });
    if (status) expect(response.status(), route).toBe(status);
    else expect(response.ok(), route + ' returned ' + response.status()).toBe(true);
    return response.json();
  }
  const staff = await call('/auth/login', {
    method: 'POST',
    data: { identifier: fixture.administrator.identifier, password: fixture.password },
  });
  const phone = '+233208765432';
  const member = await call('/auth/register', {
    method: 'POST',
    data: {
      firstName: 'Service',
      lastName: 'Tester',
      phone,
      password: fixture.password,
      passwordConfirmation: fixture.password,
      role: 'MEMBER',
      groupId: fixture.group.id,
    },
  });
  const members = await call('/members', { token: member.accessToken });
  const membership = members.items.find((item) => item.user.id === member.user.id);
  expect(membership).toBeTruthy();
  const savings = await call('/savings/accounts', {
    token: member.accessToken,
    method: 'POST',
    data: { groupMemberId: membership.id },
  });
  const contribution = {
    savingsAccountId: savings.id,
    amount: '12.50',
    reference: 'LIVE-ACCEPTANCE-SAVINGS',
    paymentMethod: 'MOBILE_MONEY',
    description: 'Acceptance savings',
  };
  await call('/savings/contributions', {
    token: member.accessToken,
    method: 'POST',
    data: contribution,
  });
  await call('/savings/contributions', {
    token: member.accessToken,
    method: 'POST',
    data: contribution,
    status: 409,
  });
  const dashboard = await call('/savings/dashboard', { token: member.accessToken });
  expect(dashboard.accounts.find((item) => item.id === savings.id).balance).toBe('12.5');
  const application = await call('/loans/applications', {
    token: member.accessToken,
    method: 'POST',
    data: { amount: '100', purpose: 'Purchase seeds for planting', durationMonths: 6 },
  });
  await call('/loans/applications/' + application.id + '/status', {
    token: staff.accessToken,
    method: 'PATCH',
    data: { status: 'APPROVED' },
  });
  const loan = await call('/loans/applications/' + application.id + '/loan', {
    token: staff.accessToken,
    method: 'POST',
    data: {
      interestRate: '0',
      startDate: new Date(Date.now() - 1000).toISOString(),
      dueDate: new Date(Date.now() + 180 * 86400000).toISOString(),
    },
  });
  await call('/loans/' + loan.id + '/disburse', {
    token: staff.accessToken,
    method: 'POST',
    data: {},
  });
  const repayment = { amount: '25', reference: 'LIVE-ACCEPTANCE-REPAYMENT' };
  await call('/loans/' + loan.id + '/repayments', {
    token: member.accessToken,
    method: 'POST',
    data: repayment,
  });
  await call('/loans/' + loan.id + '/repayments', {
    token: member.accessToken,
    method: 'POST',
    data: repayment,
    status: 409,
  });
  expect((await call('/loans/' + loan.id, { token: member.accessToken })).outstandingBalance).toBe(
    '75',
  );
  const otherMember = await call('/auth/login', {
    method: 'POST',
    data: { identifier: fixture.member.identifier, password: fixture.password },
  });
  await call('/loans/' + loan.id, { token: otherMember.accessToken, status: 403 });
  await call('/system/settings', { token: member.accessToken, status: 403 });
  await call('/meetings/' + fixture.meetingId + '/attendance', {
    token: member.accessToken,
    method: 'POST',
    data: { memberUserId: member.user.id, status: 'PRESENT' },
  });
  const attendance = await call('/meetings/' + fixture.meetingId + '/attendance', {
    token: member.accessToken,
  });
  expect(attendance.find((item) => item.user.id === member.user.id).status).toBe('PRESENT');
  const transactions = await call('/financial-records', { token: member.accessToken });
  const transaction = transactions.items.find((item) => item.type === 'CONTRIBUTION');
  const pending = await call('/blockchain/verify/' + transaction.id, { token: member.accessToken });
  expect(pending.verificationResult).toBe('PENDING');
  await call('/blockchain/proofs', {
    token: member.accessToken,
    method: 'POST',
    data: {
      reference: transaction.reference,
      recordHash: pending.databaseHash,
      transactionType: transaction.type,
    },
  });
  expect(
    (await call('/blockchain/verify/' + transaction.id, { token: member.accessToken }))
      .verificationResult,
  ).toBe('VERIFIED');
  const mismatch = await call(
    '/blockchain/proofs/' + encodeURIComponent(transaction.reference) + '/verify',
    {
      token: member.accessToken,
      method: 'POST',
      data: { expectedRecordHash: 'a different record' },
    },
  );
  expect(mismatch.verified).toBe(false);
  await call('/auth/forgot-password', { method: 'POST', data: { identifier: phone } });
  const delivery = await (await request.get('http://127.0.0.1:4180/last-reset')).json();
  expect(delivery.recipient.phone).toBe(phone);
  const token = new URL(delivery.resetUrl).searchParams.get('token');
  await call('/auth/reset-password', {
    method: 'POST',
    data: { token, password: 'ChangedReviewA1!' },
  });
  await call('/auth/reset-password', {
    method: 'POST',
    data: { token, password: 'ChangedReviewA1!' },
    status: 401,
  });
  await call('/auth/login', {
    method: 'POST',
    data: { identifier: phone, password: fixture.password },
    status: 401,
  });
  await call('/auth/login', {
    method: 'POST',
    data: { identifier: phone, password: 'ChangedReviewA1!' },
  });
});
