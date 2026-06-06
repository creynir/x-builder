export function WriterPage() {
  return (
    <section className="xb-writer-page" aria-label="Writer workspace">
      <section aria-label="Idea input">
        <textarea placeholder="What are you thinking about?" />
        <button type="button">Generate</button>
      </section>
    </section>
  );
}
