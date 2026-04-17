# Messenger Step 2: Read-by Modal (Group UX)

- Group sender messages show an inline **Read by N/M** hint.
- Clicking the hint opens `ReadByModal` with:
  - **Read by** (`readAt`)
  - **Delivered to** (`deliveredAt`)
  - **Not yet delivered**
- Modal supports keyboard dismissal (`Esc`), focus trapping, and dialog semantics (`role="dialog"`, `aria-modal="true"`).
- Responsive behavior:
  - Desktop: centered modal
  - Mobile (`<640px`): bottom-sheet style
