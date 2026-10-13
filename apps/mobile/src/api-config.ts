type ApiConfiguration = {
  platform: string;
  configuredUrl?: string;
  metroHost?: string;
  webHostname?: string;
};
export function resolveApiUrl({
  platform,
  configuredUrl,
  metroHost,
  webHostname,
}: ApiConfiguration): string {
  const configured = configuredUrl?.trim();
  if (configured?.startsWith('/') && !configured.startsWith('//')) {
    if (platform !== 'web')
      throw new Error('Set EXPO_PUBLIC_API_URL to a full API address for the mobile app.');
    return configured.replace(/\/+$/, '');
  }
  const fallback =
    platform === 'android' ? 'http://10.0.2.2:3000/api' : 'http://localhost:3000/api';
  const url = new URL(configured || fallback);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('The API address must be an HTTP or HTTPS URL without embedded credentials.');
  const loopback = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(url.hostname);
  let parsedMetroHost: string | undefined;
  if (metroHost) {
    try {
      parsedMetroHost = new URL(metroHost.includes('://') ? metroHost : 'http://' + metroHost)
        .hostname;
    } catch {
      /* Use the platform's development default. */
    }
  }
  const developmentHost = platform === 'web' ? webHostname : parsedMetroHost;
  if (
    loopback &&
    developmentHost &&
    !['localhost', '127.0.0.1', '0.0.0.0'].includes(developmentHost)
  )
    return buildAddress(url, developmentHost);
  else if (loopback && platform === 'android' && !developmentHost)
    return buildAddress(url, '10.0.2.2');
  return url.toString().replace(/\/+$/, '');
}

function buildAddress(url: URL, hostname: string): string {
  // React Native's URL exposes getters but does not implement a hostname setter.
  return (
    url.protocol +
    '//' +
    hostname +
    (url.port ? ':' + url.port : '') +
    url.pathname +
    url.search +
    url.hash
  ).replace(/\/+$/, '');
}
