import React from "react";

// Postman-style JSON syntax highlighting. Pretty-prints valid JSON and colors
// keys / strings / numbers / booleans / null via token classes. Non-JSON text
// is shown as-is (plain), so it works for any payload.

type Token = { text: string; cls: string };

function tokenize(json: string): Token[] {
  const tokens: Token[] = [];
  // Matches: strings (with optional trailing colon => key), numbers, literals, punctuation.
  const re =
    /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}\[\],])|(\s+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(json)) !== null) {
    if (m.index > last) {
      tokens.push({ text: json.slice(last, m.index), cls: "" });
    }
    if (m[1]) {
      // string literal; if followed by colon it's a key
      if (m[2]) {
        tokens.push({ text: m[1], cls: "jt-key" });
        tokens.push({ text: m[2], cls: "" });
      } else {
        tokens.push({ text: m[1], cls: "jt-str" });
      }
    } else if (m[3]) {
      tokens.push({ text: m[3], cls: "jt-num" });
    } else if (m[4]) {
      tokens.push({ text: m[4], cls: m[4] === "null" ? "jt-null" : "jt-bool" });
    } else if (m[5]) {
      tokens.push({ text: m[5], cls: "jt-punc" });
    } else if (m[6]) {
      tokens.push({ text: m[6], cls: "" });
    }
    last = re.lastIndex;
  }
  if (last < json.length) tokens.push({ text: json.slice(last), cls: "" });
  return tokens;
}

export function JsonView(props: { text: string; isJson: boolean }) {
  // Only attempt highlighting when the content is (or parses as) JSON.
  let pretty = props.text;
  let ok = props.isJson;
  if (ok) {
    try {
      pretty = JSON.stringify(JSON.parse(props.text), null, 2);
    } catch {
      ok = false;
    }
  }

  if (!ok) {
    return <pre className="json-view">{props.text}</pre>;
  }

  const tokens = tokenize(pretty);
  return (
    <pre className="json-view">
      {tokens.map((t, i) =>
        t.cls ? (
          <span key={i} className={t.cls}>
            {t.text}
          </span>
        ) : (
          <React.Fragment key={i}>{t.text}</React.Fragment>
        )
      )}
    </pre>
  );
}
