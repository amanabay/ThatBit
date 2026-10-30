import type { PublicReply } from "../../../../../shared/contracts/models.ts";
export function readerShell(html: string) {
  const marker = '<meta name="replylink-app" content="reader">';
  return html.includes(marker)
    ? html
    : html.replace("</head>", marker + "\n</head>");
}
export function readerOrigin(value: string) {
  const origin = new URL(value);
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(origin.hostname)
      ))
  )
    throw new Error(
      "Reader public origin requires HTTPS, or loopback HTTP for local development.",
    );
  return origin.origin;
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? "",
  );
export function previewPage(
  html: string,
  reply: PublicReply | undefined,
  origin: string,
) {
  const title = reply?.title ?? "Replay unavailable — ReplyLink";
  const description = reply
    ? `@${reply.author}: ${reply.message}`
    : "This replay is unavailable.";
  const tags = [
    `<title>${escape(title)}</title>`,
    `<meta name="description" content="${escape(description)}">`,
  ];
  if (reply) {
    const url = origin + "/r/" + reply.id,
      image = origin + "/api/public/replies/" + reply.id + "/preview";
    for (const [name, value] of Object.entries({
      "og:type": "website",
      "og:site_name": "ReplyLink",
      "og:title": title,
      "og:description": description,
      "og:url": url,
      "og:image": image,
      "og:image:type": "image/png",
      "og:image:width": "1200",
      "og:image:height": "630",
      "og:image:alt": `Original message from ${reply.author} and a frame of ${reply.creator || "the creator"}'s approved response.`,
    }))
      tags.push(`<meta property="${name}" content="${escape(value)}">`);
    tags.push(
      `<meta name="twitter:card" content="summary_large_image">`,
      `<link rel="canonical" href="${escape(url)}">`,
    );
  } else tags.push('<meta name="robots" content="noindex">');
  return readerShell(html)
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(/<meta\s+name="description"[^>]*>/i, "")
    .replace("</head>", tags.join("\n") + "\n</head>");
}
