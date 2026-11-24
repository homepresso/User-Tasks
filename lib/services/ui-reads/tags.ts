import { z } from 'zod'
import * as tags from '../tags'
import { defineRead, NO_ARGS } from './define'

/** Tag colours: the workspace's styles (every chip, any member), autocomplete, and Settings → Tags (tags in use with counts, the objects carrying one). */
export const reads = {
  'tags.styles': defineRead({
    args: NO_ARGS,
    run: async (ctx) => tags.listTagStyles(ctx),
  }),

  'tags.list': defineRead({
    args: z.object({ q: z.string().max(100).optional() }).optional(),
    perm: ['settings.view', 'tags.manage'],
    run: async (ctx, args) => tags.listTags(ctx, { q: args?.q ?? null }),
  }),

  /** Autocomplete wherever tags are added (any member; ranked, with colours and usage). */
  'tags.suggest': defineRead({
    args: z.object({ q: z.string().max(100).optional(), limit: z.number().int().min(1).max(50).optional() }).optional(),
    run: async (ctx, args) => tags.suggestTags(ctx, { q: args?.q ?? null, limit: args?.limit ?? 10 }),
  }),

  /** Settings → Tags detail panel: the objects of one type carrying a tag (RLS applies). */
  'tags.objects': defineRead({
    args: z.object({ name: z.string().min(1).max(60), type: z.string().max(20), limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).optional() }),
    perm: ['settings.view', 'tags.manage'],
    run: async (ctx, args) => tags.listTagObjects(ctx, args),
  }),
}
