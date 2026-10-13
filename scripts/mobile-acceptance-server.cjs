const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const { JsonRpcProvider, Wallet, ContractFactory } = require('ethers');

const root = path.resolve(__dirname, '..');
const evidence = path.join(root, '.acceptance');
fs.mkdirSync(evidence, { recursive: true });
const apiDirectory = path.join(root, 'apps/api');
const webRoot = path.join(root, 'apps/mobile/dist-review');
const configuration = dotenv.parse(fs.readFileSync(path.join(apiDirectory, '.env')));
const servers = [];
const databaseName = `rcm_ui_acceptance_${Date.now()}`;
const resetDeliveries = [];
const shutdownKey = randomBytes(24).toString('hex');
const apiOrigin = 'http://127.0.0.1:3010';
// Public development key supplied by the local Hardhat test node, never a live wallet.
const developmentKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

async function ready(url, body) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const result = await fetch(url, {
        ...(body
          ? {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }
          : {}),
        signal: AbortSignal.timeout(1500),
      });
      if (result.ok) return result.json();
    } catch {
      /* Startup may take a few seconds. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Acceptance service did not start: ${url}. See .acceptance logs.`);
}

function listen(server, port) {
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

async function main() {
  const databaseUrl = new URL(configuration.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname))
    throw new Error('Acceptance tests require a local PostgreSQL server.');
  if (!fs.existsSync(path.join(webRoot, 'index.html')))
    throw new Error('Export the mobile app to dist-review before running acceptance tests.');
  const administration = new PrismaClient({
    datasources: { db: { url: configuration.DATABASE_URL } },
  });
  try {
    // Generated database name contains only a fixed prefix and decimal digits.
    await administration.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await administration.$disconnect();
  }
  databaseUrl.pathname = '/' + databaseName;
  databaseUrl.searchParams.set('connection_limit', '2');
  databaseUrl.searchParams.set('pool_timeout', '30');
  const databaseConnection = databaseUrl.toString();
  const postgresRoot = path.join(process.env.ProgramFiles || 'C:/Program Files', 'PostgreSQL');
  const installed = fs.existsSync(postgresRoot)
    ? fs
        .readdirSync(postgresRoot)
        .map((version) => path.join(postgresRoot, version, 'bin/psql.exe'))
        .find((file) => fs.existsSync(file))
    : undefined;
  if (installed) {
    // Apply the repository's SQL to this fresh database without a second schema-engine process.
    const migrations = path.join(apiDirectory, 'prisma/migrations');
    for (const name of fs.readdirSync(migrations).sort()) {
      const sql = path.join(migrations, name, 'migration.sql');
      if (!fs.existsSync(sql)) continue;
      execFileSync(
        installed,
        [
          '-X',
          '-v',
          'ON_ERROR_STOP=1',
          '-h',
          databaseUrl.hostname,
          '-p',
          databaseUrl.port || '5432',
          '-U',
          decodeURIComponent(databaseUrl.username),
          '-d',
          databaseName,
          '-f',
          sql,
        ],
        {
          env: { ...process.env, PGPASSWORD: decodeURIComponent(databaseUrl.password) },
          windowsHide: true,
          stdio: 'pipe',
          timeout: 30000,
        },
      );
    }
  } else {
    execFileSync(
      process.execPath,
      [
        path.join(root, 'node_modules/prisma/build/index.js'),
        'migrate',
        'deploy',
        '--schema',
        path.join(apiDirectory, 'prisma/schema.prisma'),
      ],
      {
        cwd: apiDirectory,
        env: { ...process.env, DATABASE_URL: databaseConnection },
        stdio: 'pipe',
        windowsHide: true,
        timeout: 120000,
      },
    );
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseConnection } } });
  const password = 'ReviewA1!' + randomBytes(8).toString('hex');
  let fixture;
  try {
    for (const name of [
      'MEMBER',
      'GROUP_MANAGER',
      'TREASURER',
      'AUDITOR',
      'LOAN_OFFICER',
      'ADMIN',
      'SUPER_ADMIN',
    ])
      await prisma.role.create({ data: { name } });
    const memberRole = await prisma.role.findUniqueOrThrow({ where: { name: 'MEMBER' } });
    const administratorRole = await prisma.role.findUniqueOrThrow({
      where: { name: 'SUPER_ADMIN' },
    });
    const passwordHash = await bcrypt.hash(password, 12);
    const administrator = await prisma.user.create({
      data: {
        firstName: 'Review',
        lastName: 'Officer',
        email: 'officer@acceptance.test',
        passwordHash,
        roleId: administratorRole.id,
        status: 'ACTIVE',
      },
    });
    const member = await prisma.user.create({
      data: {
        firstName: 'Ama',
        lastName: 'Mensah',
        phone: '+233201234567',
        passwordHash,
        roleId: memberRole.id,
        status: 'ACTIVE',
      },
    });
    const group = await prisma.communityGroup.create({
      data: {
        name: 'Acceptance community',
        registrationNo: 'UI-REVIEW-001',
        location: 'Test village',
        contactInfo: '+233201234568',
        managerId: administrator.id,
      },
    });
    const membership = await prisma.groupMember.create({
      data: { userId: member.id, groupId: group.id, memberNumber: 'MBR-000001' },
    });
    const savings = await prisma.savingsAccount.create({
      data: { groupMemberId: membership.id, accountNumber: 'UI-SAVINGS-001' },
    });
    const meeting = await prisma.meeting.create({
      data: {
        title: 'Monthly savings meeting',
        groupId: group.id,
        organizerId: administrator.id,
        scheduledAt: new Date(Date.now() + 3600000),
        location: 'Community hall',
        agenda: 'Review savings and repayments',
      },
    });
    await prisma.notification.create({
      data: {
        userId: member.id,
        title: 'Welcome, Ama',
        message: 'Your community account is ready.',
        type: 'GENERAL',
        status: 'SENT',
      },
    });
    await prisma.systemSetting.create({
      data: { key: 'community_help', value: { contact: 'Your group manager' } },
    });
    fixture = {
      shutdownKey,
      serverPid: process.pid,
      apiOrigin,
      databaseName,
      password,
      administrator: { id: administrator.id, identifier: administrator.email },
      member: { id: member.id, identifier: member.phone },
      group,
      membershipId: membership.id,
      savingsId: savings.id,
      meetingId: meeting.id,
    };
  } finally {
    await prisma.$disconnect();
  }

  global.gc?.();
  // An actual isolated Hardhat network, hosted in-process to keep memory use low.
  const { createHardhatRuntimeEnvironment } = await import('hardhat/hre');
  const hre = await createHardhatRuntimeEnvironment(
    { networks: { acceptance: { type: 'edr-simulated', chainId: 31337 } } },
    {},
    path.join(root, 'packages/contracts'),
  );
  const chainServer = await hre.network.createServer('acceptance', '127.0.0.1', 8555);
  servers.push(chainServer);
  await chainServer.listen();
  const provider = new JsonRpcProvider('http://127.0.0.1:8555');
  let contractAddress;
  try {
    const artifact = JSON.parse(
      fs.readFileSync(
        path.join(
          root,
          'packages/contracts/artifacts/contracts/TransactionProofRegistry.sol/TransactionProofRegistry.json',
        ),
      ),
    );
    const contract = await new ContractFactory(
      artifact.abi,
      artifact.bytecode,
      new Wallet(developmentKey, provider),
    ).deploy();
    await contract.waitForDeployment();
    contractAddress = await contract.getAddress();
  } finally {
    provider.destroy();
  }

  await listen(
    http.createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/last-reset') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(resetDeliveries.at(-1) ?? null));
        return;
      }
      if (request.method !== 'POST' || request.url !== '/deliver-reset') {
        response.writeHead(404);
        response.end();
        return;
      }
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        try {
          resetDeliveries.push(JSON.parse(body));
          response.writeHead(204);
          response.end();
        } catch {
          response.writeHead(400);
          response.end();
        }
      });
    }),
    4180,
  );

  Object.assign(process.env, configuration, {
    DATABASE_URL: databaseConnection,
    API_PORT: '3010',
    NODE_ENV: 'test',
    JWT_SECRET: randomBytes(32).toString('hex'),
    PASSWORD_RESET_WEBHOOK_URL: 'http://127.0.0.1:4180/deliver-reset',
    PASSWORD_RESET_URL: 'http://127.0.0.1:4173/reset-password',
    BLOCKCHAIN_RPC_URL: 'http://127.0.0.1:8555',
    BLOCKCHAIN_PRIVATE_KEY: developmentKey,
    CONTRACT_ADDRESS: contractAddress,
  });
  const application = await require(path.join(apiDirectory, 'dist/main.js')).bootstrap();
  servers.push(application);
  await ready(apiOrigin + '/api/health');
  fixture.expiredAccessToken = new (require('@nestjs/jwt').JwtService)().sign(
    { sub: fixture.member.id, role: 'MEMBER' },
    { secret: process.env.JWT_SECRET, expiresIn: -1 },
  );
  fs.writeFileSync(path.join(evidence, 'fixture.json'), JSON.stringify(fixture));

  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
  };
  await listen(
    http.createServer((request, response) => {
      if (
        request.method === 'POST' &&
        request.url === '/__acceptance/shutdown' &&
        request.headers['x-acceptance-key'] === shutdownKey
      ) {
        response.writeHead(204);
        response.end();
        setTimeout(() => process.exit(0), 50);
        return;
      }
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      let file = path.resolve(webRoot, '.' + pathname);
      if (!file.startsWith(webRoot + path.sep) && file !== webRoot) {
        response.writeHead(403);
        response.end();
        return;
      }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory())
        file = path.join(webRoot, 'index.html');
      response.setHeader(
        'content-type',
        mimeTypes[path.extname(file)] ?? 'application/octet-stream',
      );
      response.setHeader('cache-control', 'no-store');
      fs.createReadStream(file).pipe(response);
    }),
    4173,
  );
  console.log(
    'Mobile acceptance services ready (isolated database, API, reset receiver, and local blockchain).',
  );
}

function stop() {
  for (const server of servers) server.close();
}
process.on('SIGINT', () => {
  stop();
  process.exit();
});
process.on('SIGTERM', () => {
  stop();
  process.exit();
});
process.on('exit', stop);
main().catch((error) => {
  console.error(error.message);
  stop();
  process.exitCode = 1;
});
