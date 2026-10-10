import { useEffect, useRef } from 'react'

export function useInfiniteScroll(loadMore: () => void, enabled: boolean) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!enabled || !sentinelRef.current) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) loadMore()
    }, { root: containerRef.current, rootMargin: '100px' })
    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [enabled, loadMore])

  return { containerRef, sentinelRef }
}
