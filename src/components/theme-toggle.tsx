import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/hooks/use-theme'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const label = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-lg"
      className="fixed right-6 bottom-6 z-50 size-12 rounded-full shadow-lg"
      aria-label={label}
      title={label}
      onClick={toggleTheme}
    >
      {theme === 'light' ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
    </Button>
  )
}
