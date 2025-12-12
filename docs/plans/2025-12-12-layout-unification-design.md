# Layout Unification & Secret Broadcast Fix

**Date:** 2025-12-12
**Status:** Approved

## Overview

Unify the navigation layout across all pages to follow a consistent pattern, and fix the YouTube embed issue in Radio's secret broadcast feature.

## Problem Statement

### Layout Inconsistencies
- Pages have inconsistent "cd .." navigation placement (some top, some bottom, some both)
- Different styling approaches (TerminalPrompt wrapper vs command prop vs flex rows)
- Radio page has top navigation, Swagger has top, most others have bottom only

### Secret Broadcast Embed Failure
- YouTube embeds in Radio's midnight secret broadcast show "Video unavailable"
- Same videos work correctly in Konami page
- Root cause: Missing iframe attributes that Konami has

## Design

### Layout Pattern

All pages (except Index and Terminal) will follow this structure:

```
┌─────────────────────────────────────────┐
│ ● ● ●  sandbox@gitgud.zip:~/page        │  ← TerminalHeader
├─────────────────────────────────────────┤
│ user@terminal:~$ cd ..                  │  ← TOP: Back nav prompt
│ user@terminal:~/page$ main-command      │  ← Main command
│                                         │
│ ... page content ...                    │
│                                         │
│ user@terminal:~/page$ cd ..             │  ← BOTTOM: Back nav prompt
│ user@terminal:~/page$ █                 │  ← Cursor prompt
└─────────────────────────────────────────┘
```

**Top navigation format:**
```tsx
<TerminalPrompt path="~">
  <Link to="/" className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow">
    cd ..
  </Link>
</TerminalPrompt>
```

**Bottom navigation format:**
```tsx
<TerminalPrompt path="~/page">
  <Link to="/" className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow">
    cd ..
  </Link>
</TerminalPrompt>
<TerminalPrompt path="~/page">
  <TerminalCursor />
</TerminalPrompt>
```

### Secret Broadcast Fix

**1. Add missing iframe attributes:**
```tsx
<iframe
  title="Secret Broadcast Feed"
  src={secretEmbedUrl}
  allow="autoplay; encrypted-media; picture-in-picture"
  referrerPolicy="strict-origin-when-cross-origin"
  allowFullScreen
/>
```

**2. Add mute param to rickroll URL:**
```tsx
"midnight-rickroll": {
  embed: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&loop=1&playlist=dQw4w9WgXcQ&controls=0&modestbranding=1&rel=0&mute=0",
}
```

**3. Add fallback link to YouTube:**
```tsx
<p className="text-terminal-white/60 text-[0.65rem]">
  {SECRET_BROADCAST_VIDEOS[activeStation.id ?? ""].label}
  {" · "}
  <a href={SECRET_BROADCAST_VIDEOS[activeStation.id ?? ""].watch}
     target="_blank"
     rel="noopener noreferrer"
     className="text-terminal-yellow underline">
    watch on YouTube
  </a>
</p>
```

## Files to Modify

| File | Changes |
|------|---------|
| `Documents.tsx` | Add top "cd .." prompt |
| `Games.tsx` | Add top "cd .." prompt |
| `Motivation.tsx` | Add top "cd .." prompt |
| `HowToIndex.tsx` | Add top "cd .." prompt |
| `HowToTopic.tsx` | Add top "cd .." prompt |
| `Swagger.tsx` | Add bottom "cd .." + cursor prompt |
| `GitGud.tsx` | Restructure: top prompt + bottom prompt |
| `Begud.tsx` | Restructure: top prompt + bottom prompt |
| `Konami.tsx` | Add top "cd .." prompt |
| `DoNothingGamePage.tsx` | Add top "cd .." prompt |
| `Radio.tsx` | Fix iframe attributes + add fallback link |

## Files NOT Modified

- `Index.tsx` - Root page, no parent directory
- `Terminal.tsx` - Interactive shell, self-contained
- `RadioHeader.tsx` - Already has correct top navigation
- `*Docs.tsx` pages - Swagger UI embeds, different purpose

## Implementation Order

1. Fix Radio secret broadcast (quick win, isolated)
2. Update simple pages (Documents, Games, Motivation, HowToIndex)
3. Update Swagger (add bottom navigation)
4. Restructure GitGud/Begud (remove flex row pattern)
5. Update remaining pages (Konami, DoNothingGamePage, HowToTopic)
6. Visual verification of all pages
