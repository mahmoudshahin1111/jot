import { useEffect, useRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'

type InfiniteScrollProps = ComponentPropsWithoutRef<'div'> & {
  enabled: boolean
  onLoadMore: () => void
  footer?: ReactNode
}

export function InfiniteScroll({ enabled, onLoadMore, children, footer, ...props }: InfiniteScrollProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!enabled || !sentinelRef.current) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) onLoadMore()
    }, { root: containerRef.current, rootMargin: '100px' })
    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [enabled, onLoadMore])

  return (
    <div {...props} ref={containerRef}>
      {children}
      <div ref={sentinelRef} className="h-1" aria-hidden="true" />
      {footer}
    </div>
  )
}
