// Turn raw Kafka/rdkafka error strings into friendly, actionable messages.
// The backend passes librdkafka errors through verbatim; here we recognize the
// common ones and add a human hint so users aren't stuck on cryptic text.

const RULES: { match: RegExp; message: string }[] = [
  {
    match: /resolve|nodename nor servname|name or service not known|getaddrinfo/i,
    message:
      "Can't resolve the broker hostname. Check the address, your DNS, or connect to the VPN if the cluster is internal.",
  },
  {
    match: /connection refused|could not connect|transport failure|broker transport failure/i,
    message:
      "Connection refused. Is the broker reachable on that host/port, and is the port correct?",
  },
  {
    match: /timed out|timeout/i,
    message:
      "The request timed out. The broker may be unreachable, overloaded, or blocked by a firewall.",
  },
  {
    match: /authentication|sasl|unsupported.*mechanism|invalid.*credential/i,
    message:
      "Authentication failed. Check the SASL mechanism, username, and password.",
  },
  {
    match: /ssl|certificate|handshake/i,
    message:
      "TLS/SSL handshake failed. Verify the SSL setting and any required certificates.",
  },
  {
    match: /unknown topic|unknown_topic|does not exist/i,
    message: "That topic doesn't exist on this cluster.",
  },
  {
    match: /authorization|not authorized|topic_authorization/i,
    message:
      "Not authorized. Your credentials lack permission for this operation.",
  },
];

export function friendlyError(raw: unknown): string {
  const text = String(raw ?? "").trim();
  for (const rule of RULES) {
    if (rule.match.test(text)) {
      return `${rule.message}\n\n(${text})`;
    }
  }
  return text || "Unknown error.";
}
