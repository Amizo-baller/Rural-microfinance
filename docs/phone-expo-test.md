# Expo phone test

## Current connectivity correction (2026-10-10)

The Wi-Fi address changed from 192.168.0.5 to 10.244.90.147. Expo's launch-link endpoint still returned exp://192.168.0.5:8081, explaining why the old QR could not download the app. Metro responded on the new LAN address and served the Android bundle with HTTP 200 (6,872,886 bytes). The mobile API setting was updated to http://10.244.90.147:3000/api. The existing Expo/API firewall rules still used the old address; updating them requires Windows administrator elevation. The correction helper and its result file are in .phone-test/update-expo-api-firewall.ps1 and .phone-test/expo-api-firewall-update.json.

The administrator correction subsequently succeeded: both existing rules now allow 10.244.90.147 on the 10.244.90.0/24 Wi-Fi subnet. Expo still needs to be restarted in the user's visible terminal to replace its stale QR address and reload the API setting. No background development servers were started during this correction.

Stop Expo with Ctrl+C in its existing terminal, then run these commands from apps/mobile:

```powershell
$env:REACT_NATIVE_PACKAGER_HOSTNAME = '10.244.90.147'
npm.cmd run start -- --lan --port 8081 --max-workers 1 --clear
```

Scan the new QR. The backend was not accepting connections on port 3000 during diagnosis; start it in a separate visible terminal with npm.cmd run dev:api from the project root. Physical-phone connectivity remains to be confirmed. The older notes below describe previous network setups.

Computer-side checks completed:

- Expo SDK 57.0.26 dependency checks: no mismatches.
- Metro running on port 8081, with LAN host `10.244.90.147:8081`.
- Android manifest and native bundle: HTTP 200, 1,414 modules.
- iOS manifest and native bundle: HTTP 200, 1,276 modules.
- API and database started; `http://10.244.90.147:3000/api/health` returned HTTP 200.
- Fixed native startup address resolution: React Native provides read-only URL hostname getters. The resolver now builds a new address instead of assigning the hostname.
- 25 regression tests and TypeScript checks passed, including a test using React Native's actual URL implementation.

## Open on a phone

1. Connect the phone and computer to the same Wi-Fi.
2. Use Expo Go compatible with SDK 57. [Expo Go download/version selection](https://expo.dev/go?device=true&sdkVersion=57).
3. Scan `.phone-test/expo-go-qr.png`, or open `exp://10.244.90.147:8081` in Expo Go.
4. Confirm that the splash, onboarding or sign-in screen renders. The app resolves development API localhost addresses against Expo's LAN host automatically.

For an iPhone, Expo Go SDK 57 requires the same Expo account in the CLI and Expo Go. If prompted, run `npx.cmd expo login` from `apps/mobile` and sign in to that account on the phone. [Official Expo instructions](https://docs.expo.dev/get-started/start-developing/).

To check the phone's LAN connection separately, open `http://10.244.90.147:3000/api/health` in its browser. It should show `status: ok`. The IP address may change when the computer joins a different network; restart Expo and use its updated address then.

Restart commands from the repository root:

```powershell
npm.cmd run start --workspace=@rcm/api
npm.cmd run start --workspace=@rcm/mobile -- --lan --port 8081 --max-workers 1
```

Physical-phone display was confirmed by the user?s Expo Go registration-screen screenshot on 2026-10-07. Backend connectivity still requires a separate phone-side check; rendering the app does not prove API reachability.

## Failed to download remote update

The phone reported `java.io.IOException: Failed to download remote update`. The original QR used a private LAN address, while the screenshot showed 4G. The computer also has multiple active network adapters and a managed public firewall profile.

A temporary Expo-only tunnel was started on port 8084 after the initial attempt timed out. The Android manifest downloaded through the public tunnel with HTTP 200. Use the new `.phone-test/expo-tunnel-qr.png` rather than the old LAN QR. The current link is stored in `.phone-test/tunnel-link.json`; it may change when the server restarts.

The complete Android bundle also downloaded through the public tunnel with HTTP 200 (about 6.5 MB). The tunnel briefly disconnected and automatically reconnected during verification; its connection depends on the computer's internet and the tunnel provider. Physical-phone rendering is still awaiting a scan of the replacement QR.

```powershell
npm.cmd run start:tunnel --workspace=@rcm/mobile
```

Both the computer and phone need internet for tunnel mode; matching Wi-Fi is not required for downloading the app. This tunnel exposes the Expo development server, not the backend API. Sign-in and financial screens still require an API reachable from the phone. A successful computer-side tunnel download is not confirmation that the phone has opened the app.

## Registration connectivity follow-up (2026-10-07)

The user opened the app through the Expo tunnel, then registration reported that it could not connect to the server. The ignored mobile `.env` still configured an obsolete LAN API address (`10.227.206.147`). The computer now has Wi-Fi address `192.168.0.5`; its actual `/api/health` returned HTTP 200 with `status: ok`. Updated `EXPO_PUBLIC_API_URL` to `http://192.168.0.5:3000/api` and restarted Expo to reload the setting. Phone-side health and registration confirmation remain pending. This change does not expose the backend through a public tunnel.

When changing Wi-Fi or hotspot networks, update the explicit development API URL and restart Expo. For LAN Expo, the example localhost configuration can infer the Metro host; for Expo tunnel mode, configure a separate API address reachable from the phone.

## Same-Wi-Fi timeout and firewall fix (2026-10-07)

The user confirmed the phone and computer both use the same Wi-Fi. The API responded on localhost and `192.168.0.5:3000` (health HTTP 200); login and registration on the physical phone timed out. Windows Public firewall blocks inbound traffic by default and had no enabled Node/Expo-specific allow rule. Local rules are permitted by the active policy.

After an administrator-approved Windows prompt, added `RCM-Phone-API-3000`, scoped to the Node executable, TCP local port 3000, local address `192.168.0.5`, remote subnet `192.168.0.0/24`, Wi-Fi interface, and Private/Public profiles. Firewall remains enabled. The rule does not expose the API through the public Expo tunnel. Physical-phone health and authentication retry remain pending. `.phone-test/api-health-qr.png` opens the exact health URL in a browser to avoid accidental Google searches.

Remove the temporary development rule after phone testing using an administrator PowerShell: `Remove-NetFirewallRule -Name "RCM-Phone-API-3000"`. If the computer?s Wi-Fi address changes, update the app environment and replace this scoped rule.
