import dns from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
]);

const BLOCKED_HOST_SUFFIXES = [
  '.local',
  '.internal',
  '.home.arpa',
  '.localhost',
];

const privateNetworkRanges = new BlockList();
privateNetworkRanges.addSubnet('0.0.0.0', 8, 'ipv4');
privateNetworkRanges.addSubnet('10.0.0.0', 8, 'ipv4');
privateNetworkRanges.addSubnet('100.64.0.0', 10, 'ipv4');
privateNetworkRanges.addSubnet('127.0.0.0', 8, 'ipv4');
privateNetworkRanges.addSubnet('169.254.0.0', 16, 'ipv4');
privateNetworkRanges.addSubnet('172.16.0.0', 12, 'ipv4');
privateNetworkRanges.addSubnet('192.0.0.0', 24, 'ipv4');
privateNetworkRanges.addSubnet('192.168.0.0', 16, 'ipv4');
privateNetworkRanges.addSubnet('198.18.0.0', 15, 'ipv4');
privateNetworkRanges.addSubnet('224.0.0.0', 4, 'ipv4');
privateNetworkRanges.addSubnet('240.0.0.0', 4, 'ipv4');
privateNetworkRanges.addSubnet('255.255.255.255', 32, 'ipv4');
privateNetworkRanges.addSubnet('::', 128, 'ipv6');
privateNetworkRanges.addSubnet('::1', 128, 'ipv6');
privateNetworkRanges.addSubnet('fc00::', 7, 'ipv6');
privateNetworkRanges.addSubnet('fe80::', 10, 'ipv6');
privateNetworkRanges.addSubnet('ff00::', 8, 'ipv6');

export class UrlPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UrlPolicyError';
    this.code = 'URL_BLOCKED';
    this.statusCode = 403;
  }
}

function extractMappedIpv4(address) {
  const lower = address.toLowerCase();
  if (!lower.startsWith('::ffff:')) {
    return null;
  }

  const mappedAddress = lower.slice(7);
  return isIP(mappedAddress) === 4 ? mappedAddress : null;
}

function isBlockedAddress(address) {
  const family = isIP(address);
  if (family === 0) {
    return true;
  }

  if (family === 4) {
    return privateNetworkRanges.check(address, 'ipv4');
  }

  const mappedIpv4 = extractMappedIpv4(address);
  if (mappedIpv4) {
    return privateNetworkRanges.check(mappedIpv4, 'ipv4');
  }

  return privateNetworkRanges.check(address, 'ipv6');
}

async function resolveHost(hostname) {
  try {
    return await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new UrlPolicyError('Target host could not be resolved.');
  }
}

export async function assertPublicHttpUrl(inputUrl, options = {}) {
  const { blockPrivateNetwork = true } = options;
  const parsedUrl = inputUrl instanceof URL ? inputUrl : new URL(inputUrl);

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new UrlPolicyError('Only http and https URLs are allowed.');
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (!hostname) {
    throw new UrlPolicyError('URL hostname is missing.');
  }

  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new UrlPolicyError('Local and internal hostnames are not allowed.');
  }

  if (!blockPrivateNetwork) {
    return parsedUrl;
  }

  if (isIP(hostname) > 0) {
    if (isBlockedAddress(hostname)) {
      throw new UrlPolicyError('Private and reserved network targets are not allowed.');
    }

    return parsedUrl;
  }

  const addresses = await resolveHost(hostname);
  if (addresses.length === 0) {
    throw new UrlPolicyError('Target host could not be resolved.');
  }

  for (const record of addresses) {
    if (isBlockedAddress(record.address)) {
      throw new UrlPolicyError('Private and reserved network targets are not allowed.');
    }
  }

  return parsedUrl;
}
