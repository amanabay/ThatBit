export function Logo() {
  return (
    <a className="brand" href="/">
      <span className="logo" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <circle cx="9" cy="7" r="2" fill="currentColor" />
          <path
            d="M9 12v6a4 4 0 0 0 4 4h10m-5-5 5 5-5 5"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>{" "}
      replylink
      <span className="beta">STUDIO</span>
    </a>
  );
}
