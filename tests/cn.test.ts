import { describe, expect, it } from 'vitest'
import { cn } from '../src/utils/cn'

describe('cn', () => {
  it('merges conflicting tailwind classes', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })
})
