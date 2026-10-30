import { Logo } from "../components/Logo.tsx";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
export function ReaderHome() {
  return (
    <main className="viewer">
      <div className="viewer-topbar">
        <Logo studio={false} />
        <ThemeToggle />
      </div>
      <section className="empty" aria-label="Replay links">
        <p className="eyebrow">EVERY REPLY HAS A REPLAY</p>
        <h1>Open a replay link.</h1>
        <p>
          Follow a link shared by its creator to watch the original message and
          recorded response together.
        </p>
      </section>
      <footer>Good conversations deserve to stay.</footer>
    </main>
  );
}
