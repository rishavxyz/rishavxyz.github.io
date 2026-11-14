import { dirname } from 'node:path'
import { parseArgs } from 'node:util'

import { DIRS } from './index'
import { die, fdate, type FileCons, fjoin, readglob, slugify, tsnow, unwrap, write } from './utils'

export type CommonMetadata = {
  title: string
  excerpt: string
  slug: string
  draft: boolean
  at: string
}

export type BlogMetadata = { category: string | null } & CommonMetadata
export type PageMetadata = { label: string } & CommonMetadata

export type BlogInitOpts = Pick<BlogMetadata, 'title' | 'excerpt'> &
  Partial<Omit<BlogMetadata, 'title' | 'excerpt'>>

export type PageInitOpts = Pick<PageMetadata, 'title' | 'excerpt' | 'label'> &
  Partial<Omit<PageMetadata, 'title' | 'excerpt' | 'label'>>

type InitOpts = [initfor: 'blog', opts: BlogInitOpts] | [initfor: 'page', opts: PageInitOpts]

async function initContentImpl(...[initfor, opts]: InitOpts): Promise<string | null> {
  const { title, excerpt } = opts
  const draft = opts.draft ?? true
  const now = tsnow()

  let dir = '',
    label = '',
    slug = '',
    category: string | null = ''

  if (initfor === 'blog') {
    category = opts.category ?? null
    dir = fjoin(DIRS.BLOGS, now.id)
    slug = opts.slug ?? slugify(title)
  } else if (initfor === 'page') {
    label = opts.label
    dir = fjoin(DIRS.PAGES, slugify(label))
    slug = opts.slug ?? slugify(label)
  } else {
    const idk: never = initfor
    return `"${idk}" is invalid template`
  }

  const metaContent =
    initfor === 'blog'
      ? { title, excerpt, draft, at: now.z, category, slug }
      : { title, excerpt, draft, at: now.z, label, slug }

  const metafile: FileCons = {
    name: fjoin(dir, 'metadata.json'),
    content: metaContent,
  }
  const mainfile: FileCons = {
    name: fjoin(dir, 'README.md'),
    content: `# ${title}\n\n${excerpt}`,
  }

  const result = await unwrap(async () => await Promise.all([metafile, mainfile].map(write)))
  if (!result.ok) die(result.err)
  return null
}

export const initContent = {
  Blog: (publish: boolean, category: string | null, title: string, excerpt: string) =>
    initContentImpl('blog', { title, excerpt, draft: !publish, category }),
  Page: (publish: boolean, label: string, title: string, excerpt: string) =>
    initContentImpl('page', { title, excerpt, draft: !publish, label }),
}

async function loadblogs() {
  const glob = await readglob<BlogMetadata>(DIRS.BLOGS, 'metadata.json')
  return glob
    .map((it) => {
      const title = it.content.title.slice(0, 27) + '...'
      const dir = fjoin(DIRS.BLOGS, dirname(it.name))
      return {
        dir,
        title,
        draft: it.content.draft,
        at: +new Date(it.content.at),
      }
    })
    .sort((a, b) => b.at - a.at)
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv,
    options: {
      list: { type: 'boolean', short: 'l' },
      create: { type: 'string', short: 'c' }, // will impl later
    },
    allowPositionals: true,
  })

  if (values.list) {
    const blogs = await loadblogs()
    for (const blog of blogs) {
      console.log('%s %s  =>  %s', blog.draft ? '(draft)' : ' '.repeat(7), blog.title, blog.dir)
    }
  }
}
