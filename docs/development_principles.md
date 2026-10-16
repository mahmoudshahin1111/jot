# Development principles

This is the single source of truth for principles that guide development in
Jot. Add shared, durable guidance here instead of repeating it across multiple
README files. Keep setup instructions and feature-specific details in their
respective guides, and link to this document when they need to refer to a
principle.

## Principles

### Colocate page-specific code

Keep each page in `src/pages/<page>/page.tsx`. Place hooks and components used
only by that page in its `hooks/` and `components/` subfolders, using relative
imports within the page folder. Create these subfolders only when needed.
Keep reusable hooks in `src/hooks/`, shared components in `src/components/`,
and shared data access and helpers in `src/lib/`. Shared code must not import
page internals; promote code to a shared folder when another page needs it.

### Keep presentation reasons in pages and components

Hooks manage state, actions, and boolean capability checks. Pages and components
decide how those capabilities affect button visibility or disabled states and
own the explanatory messages and tooltips. Expose permission facts or check
functions rather than page-specific reason strings. Preserve action guards in
hooks and authorization enforcement on the server.

### Dynamic text must not displace adjacent controls

Treat user-defined names and other dynamic labels as potentially long. In
compact rows and headers, constrain their containers and truncate with an
ellipsis so badges, buttons, and other adjacent items stay visible rather than
wrapping because of the text. Use `min-w-0` on shrinking flex/grid children,
`truncate` on labels, and `shrink-0` on adjacent controls. Preserve the full
value in the DOM and expose it with a title or accessible tooltip.

Allow deliberate responsive stacking when the viewport cannot fit the controls;
do not truncate essential instructions or error messages just to keep one line.
