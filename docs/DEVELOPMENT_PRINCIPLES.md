# Development principles

This is the single source of truth for principles that guide development in
Jot. Add shared, durable guidance here instead of repeating it across multiple
README files. Keep setup instructions and feature-specific details in their
respective guides, and link to this document when they need to refer to a
principle.

## Principles

### Dynamic text must not displace adjacent controls

Treat user-defined names and other dynamic labels as potentially long. In
compact rows and headers, constrain their containers and truncate with an
ellipsis so badges, buttons, and other adjacent items stay visible rather than
wrapping because of the text. Use `min-w-0` on shrinking flex/grid children,
`truncate` on labels, and `shrink-0` on adjacent controls. Preserve the full
value in the DOM and expose it with a title or accessible tooltip.

Allow deliberate responsive stacking when the viewport cannot fit the controls;
do not truncate essential instructions or error messages just to keep one line.
