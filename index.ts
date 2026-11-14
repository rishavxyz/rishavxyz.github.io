import { rm } from 'node:fs/promises'

import type { BlogMetadata, PageMetadata } from './cli'
import * as utils from './utils'

const SITE_URL = 'https://rishavxyz.github.io'
const SITE_NAME = 'Rishav Mandal'

export const DIRS = {
  BUILD: 'live',
  PAGES: 'content/pages',
  BLOGS: 'content/blogs',
  TEMPLATE: 'template',
  CSS: 'css',
  ASSETS: 'assets',
} as const

type NavLink = { slug: string; label: string; at?: string }
type BlogItem = BlogMetadata & { dir: string }
type SeoOpts = {
  title: string
  excerpt: string
  slug: string
  draft?: boolean
  at?: string
  category?: string | null
}

const toUrl = (path: string) => {
  const p = path.replace(/^\/+/, '').replace(/\/+$/, '')
  return p ? `${SITE_URL}/${p}/` : `${SITE_URL}/`
}

function genNavLinks(a: NavLink[]) {
  const cap = (s: string) => s.at(0)!.toUpperCase() + s.slice(1)
  return a
    .filter((it) => !utils.ishome(it))
    .map(
      (it) =>
        `<li><a href="${it.slug.endsWith('/') ? it.slug : it.slug + '/'}">${cap(it.label)}</a></li>`,
    )
    .join('\n\t')
}

function genSeo(c: SeoOpts) {
  const url = toUrl(c.slug)
  const desc = utils.esc(c.excerpt)
  const title = c.title === SITE_NAME ? c.title : `${utils.esc(c.title)} | ${SITE_NAME}`
  const robots = ['index', 'follow'].map((s) => (c.draft ? 'no' + s : s)).join(', ')

  const tags = utils.cn<string>(
    `<title>${title}</title>`,
    `<meta name="description" content="${desc}">`,
    `<meta name="robots" content="${robots}">`,
    !c.draft && c.at && `<meta property="article:published_time" content="${c.at}">`,
    !c.draft &&
      `<link rel="canonical" href="${url}">
     <meta property="og:type" content="${c.category ? 'article' : 'website'}">
     <meta property="og:site_name" content="${SITE_NAME}">
     <meta property="og:title" content="${title}">
     <meta property="og:description" content="${desc}">
     <meta property="og:url" content="${url}">
     <meta name="twitter:card" content="summary_large_image">
     <meta name="twitter:title" content="${title}">
     <meta name="twitter:description" content="${desc}">
    `,
  )
  return tags.join('\n')
}

async function buildFonts() {
  const globs = await utils.readglob<Uint8Array>(utils.fjoin(DIRS.ASSETS, 'fonts'), '*.woff2')
  type Font = {
    name: string
    url: string
    weight: string
    style: 'italic' | 'normal'
  }
  const renderFont = (f: Font) =>
    `
    @font-face {
      font-family: "${f.name}";
      src: url("${f.url}") format("woff2");
      font-weight: ${f.weight};
      font-style: ${f.style};
      font-display: swap;
    }
  `.trim()

  const fontFaces: string[] = []

  for (const fc of globs) {
    const name = utils.dirname(fc.name)
    const style = fc.name.includes('italic') ? 'italic' : 'normal'
    const isvar = fc.name.includes('var')

    const hashedName = `${name}-${utils.hash(fc.content)}-${utils.basename(fc.name)}`
    const url = utils.fjoin('/fonts', hashedName)

    await utils.write({
      name: utils.fjoin(DIRS.BUILD, url),
      content: fc.content,
    })
    fontFaces.push(renderFont({ name, style, url, weight: isvar ? '200 800' : '400' }))
  }

  const fontFace = fontFaces.join('\n')
  const cssFontFile: utils.FileCons = {
    name: utils.fjoin(DIRS.BUILD, 'css', `${utils.hash(fontFace)}-font.css`),
    content: fontFace,
  }
  utils.write(cssFontFile)
  return cssFontFile.name.replace(DIRS.BUILD, '')
}

async function buildCSSAndAssets() {
  const favicon = Bun.file(utils.fjoin(DIRS.ASSETS, 'favicon.ico'))
  if (await favicon.exists()) await Bun.write(utils.fjoin(DIRS.BUILD, 'favicon.ico'), favicon)

  const appleTouch = Bun.file(utils.fjoin(DIRS.ASSETS, 'apple-touch-icon.png'))
  if (await appleTouch.exists())
    await Bun.write(utils.fjoin(DIRS.BUILD, 'apple-touch-icon.png'), appleTouch)

  const fontFileName = await buildFonts()
  const fontFileTag = `<link rel="stylesheet" href="${fontFileName}">`

  const globs = await utils.readglob<string>(DIRS.CSS, '*.css')
  const cssTags: string[] = []
  let siteCssTag = ''

  for (const fc of globs) {
    const hashName = `${utils.hash(fc.content)}-${utils.basename(fc.name)}`
    const url = utils.fjoin('/css', hashName)
    await utils.write({
      name: utils.fjoin(DIRS.BUILD, url),
      content: fc.content,
    })
    const tag = `<link rel="stylesheet" href="${url}">`

    if (fc.name.includes('site.css')) siteCssTag = tag
    else cssTags.push(tag)
  }
  // site.css goes at the last for precedence
  return [fontFileTag, ...cssTags, siteCssTag].join('\n')
}

async function getNavLinks(): Promise<NavLink[]> {
  const globs = await utils.readglob<PageMetadata>(DIRS.PAGES, 'metadata.json')
  const links: NavLink[] = globs
    .filter((it) => !it.content.draft)
    .map((it) => ({
      slug: utils.fjoin('/', it.content.slug),
      label: it.content.label,
      at: it.content.at,
    }))
  links.push({ slug: '/blogs', label: 'blogs' })
  return links
}

async function buildPages(css: string, navlinks: NavLink[]) {
  const globs = await utils.readglob<PageMetadata>(DIRS.PAGES, 'metadata.json')
  const navlinkHtml = genNavLinks(navlinks)
  const copyright = utils.genCC()

  for (const fc of globs.filter((it) => !it.content.draft)) {
    let dir = utils.dirname(fc.name)
    const readmeFile = Bun.file(utils.fjoin(DIRS.PAGES, dir, 'README.md'))
    if (!(await readmeFile.exists())) utils.die(`README.md missing for page ${dir}`)

    const html = utils.md2html(await readmeFile.text(), { headings: true })
    dir = utils.ishome(fc.content) ? '/' : dir

    const pageHtml = await utils.genHtmlPage({
      '%%sitename%%': SITE_NAME,
      '%%css%%': css,
      '%%seo%%': genSeo(fc.content),
      '%%content%%': html,
      '%%navlinks%%': navlinkHtml,
      '%%copyright%%': copyright,
    })

    await utils.write({
      name: utils.fjoin(DIRS.BUILD, dir, 'index.html'),
      content: utils.htmlpp(pageHtml),
    })
  }
}

async function getBlogs(): Promise<BlogItem[]> {
  const globs = await utils.readglob<BlogMetadata>(DIRS.BLOGS, 'metadata.json')
  return globs
    .filter((it) => !it.content.draft)
    .map((it) => ({ dir: utils.dirname(it.name), ...it.content }))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}

async function buildBlogs(css: string, navlinks: NavLink[], blogs: BlogItem[]) {
  const navlinkHtml = genNavLinks(navlinks)
  const copyright = utils.genCC()
  const cards: string[] = []

  for (const blog of blogs) {
    const readmeFile = Bun.file(utils.fjoin(DIRS.BLOGS, blog.dir, 'README.md'))
    if (!(await readmeFile.exists())) utils.die(`README.md missing for blog ${blog.dir}`)

    const md = await readmeFile.text()
    const content = [
      `<section class="blog">`,
      utils.md2html(md, { headings: true }),
      `</section>`,
      `<p style="padding-top:var(--pico-spacing); margin-bottom: 0;">`,
      `<a role="button" href="/blogs/" class="secondary">`,
      `Read more blogs`,
      `</a>`,
      `</p>`,
    ].join('\n')

    const postHtml = await utils.genHtmlPage({
      '%%sitename%%': SITE_NAME,
      '%%css%%': css,
      '%%seo%%': genSeo({ ...blog, slug: utils.fjoin('blogs', blog.slug) }),
      '%%content%%': content,
      '%%navlinks%%': navlinkHtml,
      '%%copyright%%': copyright,
    })

    const date = utils.fdate(blog.at)
    const meta = [
      `<p class="meta">`,
      `<time datetime="${blog.at}">`,
      date,
      `</time>`,
      `<span>&bull;</span>`,
      `<span>#${blog.category}</span>`,
      `</p>`,
    ].join('')

    await utils.write({
      name: utils.fjoin(DIRS.BUILD, 'blogs', blog.slug, 'index.html'),
      content: utils.htmlpp(postHtml, {
        'section.blog h1': {
          // there must be only one h1 per blog
          element(h1) {
            h1.after(meta, { html: true })
          },
        },
      }),
    })

    const card = await utils.genBlogCard({
      '%%route%%': `/blogs/${blog.slug}/`,
      '%%title%%': utils.esc(blog.title),
      '%%datetime%%': blog.at,
      '%%date%%': utils.fdate(blog.at),
      '%%excerpt%%': utils.esc(blog.excerpt),
      '%%category%%': blog.category ? `#${utils.esc(blog.category)}` : '',
    })
    cards.push(card)
  }

  const listContent = `<section class="blog-list grid">\n${cards.join('\n')}\n</section>`
  const blogsIndexHtml = await utils.genHtmlPage({
    '%%sitename%%': SITE_NAME,
    '%%css%%': css,
    '%%seo%%': genSeo({
      title: 'Blogs',
      excerpt: 'Articles no one is interested and mostly generated by AI.',
      slug: '/blogs',
    }),
    '%%content%%': listContent,
    '%%navlinks%%': navlinkHtml,
    '%%copyright%%': copyright,
  })

  await utils.write({
    name: utils.fjoin(DIRS.BUILD, 'blogs', 'index.html'),
    content: blogsIndexHtml,
  })
}

async function build404(css: string, navlinks: NavLink[]) {
  const navlinkHtml = genNavLinks(navlinks)
  const copyright = utils.genCC()
  const emptyCardHtml = await utils.genEmptyCard({
    '%%title%%': `You're lost? How!?`,
    '%%description%%': `This site has only ${navlinks.length} pages, and you're lost in here? That's brilliant ese!`,
  })

  const html404 = await utils.genHtmlPage({
    '%%sitename%%': SITE_NAME,
    '%%css%%': css,
    '%%seo%%': genSeo({
      title: `404 • You're lost`,
      slug: '/404',
      excerpt: 'Page not found',
      draft: true,
    }),
    '%%content%%': emptyCardHtml,
    '%%navlinks%%': navlinkHtml,
    '%%copyright%%': copyright,
  })

  await utils.write({
    name: utils.fjoin(DIRS.BUILD, '404.html'),
    content: html404,
  })
}

async function buildRSS(blogs: BlogItem[]) {
  const items = blogs.map((blog) => {
    const link = toUrl(utils.fjoin('blogs', blog.slug))
    const desc = utils.esc(blog.excerpt)
    const title = utils.esc(blog.title)
    const category = blog.category
    const date = new Date(blog.at).toUTCString()

    const item = utils
      .cn(
        '<item>',
        `  <title>${title}</title>`,
        `  <link>${link}</link>`,
        `  <pubDate>${date}</pubDate>`,
        `  <description>${desc}</description>`,
        `  <guid isPermaLink="true">${link}</guid>`,
        category && `  <category>${category}</category>`,
        '</item>',
      )
      .join('\n')

    return item
  })

  const rss = await utils.genTempl('rss.xml', {
    '%%title%%': SITE_NAME,
    '%%canonical%%': SITE_URL,
    '%%description%%': 'Articles and thoughts by Rishav Mandal',
    '%%buildDate%%': new Date().toUTCString(),
    '%%rssLink%%': `${SITE_URL}/rss.xml`,
    '%%items%%': items.join('\n'),
  })

  await utils.write({
    name: utils.fjoin(DIRS.BUILD, 'rss.xml'),
    content: rss,
  })
}

async function buildSitemap(navlinks: NavLink[], blogs: BlogItem[]) {
  const pageUrls = navlinks.map((link) => {
    const url = toUrl(link.slug)
    const lastmod = link.at ?? new Date().toISOString()
    return utils
      .cn('  <url>', `    <loc>${url}</loc>`, `    <lastmod>${lastmod}</lastmod>`, '  </url>')
      .join('\n')
  })

  const blogUrls = blogs.map((blog) => {
    const url = toUrl(utils.fjoin('blogs', blog.slug))
    const lastmod = blog.at
    return utils
      .cn('  <url>', `    <loc>${url}</loc>`, `    <lastmod>${lastmod}</lastmod>`, '  </url>')
      .join('\n')
  })

  const urls = [...pageUrls, ...blogUrls].join('\n')
  const sitemap = await utils.genTempl('sitemap.xml', {
    '%%urls%%': urls,
  })

  await utils.write({
    name: utils.fjoin(DIRS.BUILD, 'sitemap.xml'),
    content: sitemap,
  })
}

async function buildMiscFiles() {
  const robots = `
User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
  `.trim()

  ;[
    { name: '.nojekyll', content: '' },
    { name: 'robots.txt', content: robots },
  ]
    .map((it) => ({
      name: utils.fjoin(DIRS.BUILD, it.name),
      content: it.content,
    }))
    .forEach(async (file) => await utils.write(file))
}

async function rmdist() {
  await rm(utils.fjoin(DIRS.BUILD), { recursive: true, force: true })
}

async function updateReadme(blogs: BlogItem[]): Promise<void> {
  if (blogs.length < 1) return // do nothing

  const readme = 'README.md'
  const file = Bun.file(readme)

  if (!(await file.exists())) return
  const text = await file.text()

  const bloglist = blogs
    .filter((b) => !b.draft)
    .map((b) => {
      const repoUrl = [DIRS.BLOGS, b.dir, 'README.md'].join('/')
      const siteUrl = [SITE_URL, 'blogs', b.slug, ''].join('/')
      return `- **[${b.title}](${siteUrl})** — Read it [on GitHub](${repoUrl}).`
    })
    .join('\n')

  const regex = /(<!-- bloglist:start -->)[\s\S]*?(<!-- bloglist:end -->)/
  if (!regex.test(text)) return // fail silently, dont stop the pipeline

  const fc: utils.FileCons = {
    name: readme,
    content: text.replace(regex, (_, start, end) => [start, bloglist, end].join('\n')),
  }
  utils.write(fc)
}

type BuildContext = {
  css: string
  navlinks: NavLink[]
  blogs: BlogItem[]
}

type Pipeline = {
  [name: string]: (ctx: BuildContext) => Promise<void>
}
async function run(pipeline: Pipeline) {
  const ctx: BuildContext = {
    css: '',
    navlinks: [],
    blogs: [],
  }
  for (const step in pipeline) {
    console.log('BUILD:', step)
    const fn = pipeline[step]!
    const result = await utils.unwrap(() => fn(ctx))
    if (!result.ok) utils.die(`ERROR: ${step}: ${result.err}`)
  }
  console.log('BUILD: success!', DIRS.BUILD + '/ is ready to deploy')
}

const pipeline: Pipeline = {
  'cleaning build dir': rmdist,
  'building assets & css': async (ctx) => {
    ctx.css = await buildCSSAndAssets()
  },
  'building navlinks': async (ctx) => {
    ctx.navlinks = await getNavLinks()
  },
  'building pages': (ctx) => buildPages(ctx.css, ctx.navlinks),
  'building 404 page': (ctx) => build404(ctx.css, ctx.navlinks),
  'building blogs': async (ctx) => {
    ctx.blogs = await getBlogs()
    await buildBlogs(ctx.css, ctx.navlinks, ctx.blogs)
  },
  'building rss feed': (ctx) => buildRSS(ctx.blogs),
  'building sitemap': (ctx) => buildSitemap(ctx.navlinks, ctx.blogs),
  'building misc files': buildMiscFiles,
  'updating repo readme': (ctx) => updateReadme(ctx.blogs),
}

if (import.meta.main) run(pipeline)
