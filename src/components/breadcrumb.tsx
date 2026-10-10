import { Link } from 'react-router-dom'

export type BreadcrumbItem = {
  label: string
  to?: string
}

export function Breadcrumb({
  items,
  onNavigate,
}: {
  items: BreadcrumbItem[]
  onNavigate?: () => boolean
}) {
  return (
    <nav aria-label="Breadcrumb" className="font-mono text-xs text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-2">
        {items.map((item, index) => (
          <li key={`${index}-${item.label}`} className="flex items-center gap-2">
            {index > 0 && <span aria-hidden="true">/</span>}
            {item.to && index < items.length - 1 ? (
              <Link
                to={item.to}
                className="rounded-sm hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                onClick={event => { if (onNavigate && !onNavigate()) event.preventDefault() }}
              >
                {item.label}
              </Link>
            ) : (
              <span aria-current={index === items.length - 1 ? 'page' : undefined}>{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
