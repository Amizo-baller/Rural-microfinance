# Quick setup: terminals and MetaMask Mobile

Connect your phone and computer to the same Wi-Fi. Keep terminals 1–3 open. If a service is already running, keep it; do not start a duplicate.

Current Wi-Fi address checked on 2026-10-12: **192.168.0.5**. The previous **10.244.90.147** QR code is obsolete. Restart Expo using the command below and scan its new QR code.

## 1. Terminal 1 — React Native app

```powershell
cd "C:\Users\CENTRAL UNIVERSITY\Desktop\MY FINAL PROJECT LEVEL400\apps\mobile"
$env:REACT_NATIVE_PACKAGER_HOSTNAME = '192.168.0.5'
npm.cmd run start -- --lan --port 8081 --max-workers 1 --clear
```

Scan the QR with **Expo Go**. App address: **exp://192.168.0.5:8081**.

On the sign-in screen, **Open MetaMask** launches the wallet app. Return to Expo Go to sign in with email/phone and password. This button does not authenticate a wallet signature or connect a wallet session.

Set this line in `apps/mobile/.env`, preserving other settings. Restart Expo after changing it:

```dotenv
EXPO_PUBLIC_API_URL=http://localhost:3000/api
```

## 2. Terminal 2 — Blockchain node

For LAN Expo, the app automatically replaces localhost with Expo's current computer address. This avoids stale API addresses after Wi-Fi changes. For Expo tunnel mode, set an explicit API address reachable from the phone instead.

The earlier setup may already have a node running in the background. If port 8545 is occupied, keep that node.

Run this only when the node is stopped:

```powershell
cd "C:\Users\CENTRAL UNIVERSITY\Desktop\MY FINAL PROJECT LEVEL400\packages\contracts"
npm.cmd run node
```

Node address: **http://127.0.0.1:8545**. Chain ID: **31337**.

## 3. Terminal 4 — Compile and deploy

```powershell
cd "C:\Users\CENTRAL UNIVERSITY\Desktop\MY FINAL PROJECT LEVEL400\packages\contracts"
npm.cmd run compile
npm.cmd test
npm.cmd run typecheck
```

Check the existing deployment:

```powershell
cd "C:\Users\CENTRAL UNIVERSITY\Desktop\MY FINAL PROJECT LEVEL400"
npm.cmd run chain:check:local
```

For a fresh node, deploy and configure the backend:

```powershell
npm.cmd run chain:setup:local
npm.cmd run chain:smoke:local
```

Restarting the node resets its blockchain. Redeploy and restart the API afterwards.

## 4. Terminal 3 — Backend API

```powershell
cd "C:\Users\CENTRAL UNIVERSITY\Desktop\MY FINAL PROJECT LEVEL400"
npm.cmd run dev:api
```

If already running, restart it only after changing its configuration. Keep PostgreSQL running.

On your phone, open **http://10.244.90.147:3000/api/health**. Expected: **status: ok**.

## 5. Administrator PowerShell — Enable phone access

Open PowerShell using **Run as administrator**. Run once:

```powershell
if ((Get-Service iphlpsvc).Status -ne 'Running') { Start-Service iphlpsvc }

netsh interface portproxy add v4tov4 listenaddress=192.168.0.5 listenport=8546 connectaddress=127.0.0.1 connectport=8545 protocol=tcp

$phoneRules = @(
  @{ Name = 'RCM-Phone-Expo-8081'; Port = 8081 },
  @{ Name = 'RCM-Phone-API-3000'; Port = 3000 },
  @{ Name = 'RCM-Phone-Blockchain-8546'; Port = 8546 }
)
foreach ($phoneRule in $phoneRules) {
  if (-not (Get-NetFirewallRule -Name $phoneRule.Name -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name $phoneRule.Name -DisplayName $phoneRule.Name `
      -Direction Inbound -Action Allow -Protocol TCP -LocalPort $phoneRule.Port `
      -LocalAddress 192.168.0.5 -RemoteAddress 192.168.0.0/24 `
      -InterfaceAlias 'Wi-Fi' -Profile Any
  } else {
    Set-NetFirewallRule -Name $phoneRule.Name -LocalAddress 192.168.0.5 -RemoteAddress 192.168.0.0/24
  }
}
```

This forwards phone port **8546** to the existing node on **8545** without resetting it. Use trusted Wi-Fi. Administrator access is required.

## 6. MetaMask Mobile — Add network

Open the network selector → **Add a custom network**. Enter:

| Field           | Value                     |
| --------------- | ------------------------- |
| Network name    | RCM Local Hardhat         |
| RPC URL         | http://192.168.0.5:8546 |
| Chain ID        | 31337                     |
| Currency symbol | ETH                       |
| Block explorer  | Leave blank               |

Save and select **RCM Local Hardhat**. Use port **8546**, not Expo's **8081**. On the phone, `127.0.0.1` points to the phone.

## 7. MetaMask Mobile — Import test account

Account selector → **Add wallet** → **Import an account**. Paste this public Hardhat test key:

```text
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Expected address:

```text
0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

Rename it **RCM Local Test**. Select **RCM Local Hardhat**. Balance: approximately **10,000 test ETH**.

**This key is public. Use it only for local testing; never send real funds to it.** The backend continues signing the app's proofs.

## If connection fails

- **Port already in use:** keep the existing service.
- **MetaMask cannot connect:** check shared Wi-Fi, node, forwarding, and firewall rules.
- **IP changed:** run `ipconfig`; update the URLs, forwarding, and firewall addresses. Existing rules with old addresses must be updated.
- **Managed firewall blocks setup:** ask the computer/network administrator to allow the scoped rules.

More details: [Blockchain setup](docs/blockchain-setup.md) · [MetaMask networks](https://support.metamask.io/configure/networks/how-to-add-a-custom-network-rpc) · [Account import](https://support.metamask.io/start/use-an-existing-wallet) · [Windows forwarding](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/netsh-interface).
