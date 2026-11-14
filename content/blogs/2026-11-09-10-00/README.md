# Hono RPC Without the Ceremony: A Friendly Way to Share Your API Types

There is a particular kind of friction that shows up in TypeScript projects: you carefully describe an API on the server, then carefully describe the same API again on the client, and eventually the two descriptions stop agreeing. Nobody did anything reckless. Time simply passed.

Hono RPC is a small, very practical answer to that problem. It lets a client infer its request and response types from the Hono routes you already wrote. You still have HTTP endpoints, URLs, status codes, and normal debugging tools. The pleasant part is that your editor can now help you use them correctly.

It is not magic, and that is a feature. Let’s build the mental model first, then a tiny example.

---

## The useful idea: export the route shape

Start by defining your application routes in one value and exporting its type:

```ts
// server/app.ts
import { Hono } from 'hono'

type Todo = {
  id: string
  title: string
  done: boolean
}

const todos: Todo[] = []

const app = new Hono()
  .get('/todos', (c) => c.json({ todos }))
  .post('/todos', async (c) => {
    const body = await c.req.json<{ title?: string }>()
    const title = body.title?.trim()

    if (!title) {
      return c.json({ error: 'A title is required' }, 400 as const)
    }

    const todo = { id: crypto.randomUUID(), title, done: false }
    todos.push(todo)
    return c.json({ todo }, 201 as const)
  })

export type AppType = typeof app
export default app
```

`AppType` is the important export. It describes the routes after they have been chained together: their paths, methods, input shapes, and possible responses. Keep it near the routes, rather than attempting to recreate it in a separate `api-types.ts` file.

One small TypeScript detail is worth knowing: a literal status such as `400 as const` preserves the specific status code in the inferred response. That gives a client a better chance of narrowing a success response from an error response.

## Make a client from that type

On the frontend, Hono’s `hc` helper takes that type and produces a client with the same route tree:

```ts
// web/api.ts
import { hc } from 'hono/client'

import type { AppType } from '../server/app'

export const api = hc<AppType>('/api')
```

Calling a route looks like calling a nested object. The first time you write it, it can feel a little unusual. After that, it is mostly nice autocomplete:

```ts
const response = await api.todos.$post({
  json: { title: 'Buy coriander' },
})

if (!response.ok) {
  const { error } = await response.json()
  throw new Error(error)
}

const { todo } = await response.json()
console.log(todo.id)
```

The route is still `POST /api/todos`. Open the Network tab and you will see a normal request. Curl still works. A teammate using another language can call it. RPC here means “typed remote calls,” not “a private protocol that only your app understands.”

## Put validation at the edge, not hope in the type

This is the point where it is easy to over-credit TypeScript. The client type helps _your TypeScript client_ form a valid request. It does not stop an old mobile app, a shell script, or a curious person with curl from sending malformed JSON.

Validate at the HTTP boundary and let the inferred type follow that validation. With Hono’s validator middleware, a route can be both runtime-safe and pleasant to call:

```ts
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const createTodo = z.object({
  title: z.string().trim().min(1).max(160),
})

const app = new Hono().post('/todos', zValidator('json', createTodo), (c) => {
  const { title } = c.req.valid('json')
  const todo = { id: crypto.randomUUID(), title, done: false }
  return c.json({ todo }, 201 as const)
})
```

Now there is one honest definition of a valid body. Invalid input receives a normal HTTP error; inside the handler, `title` is a real, validated string. This is the combination to aim for: runtime validation for the world, static inference for your team.

## The boundaries are still there

Hono RPC shines when the server and TypeScript client can share a type import—often in a monorepo or a small shared package. If they deploy independently, treat the exported route type as a versioned contract. A client compiled against yesterday’s routes cannot make today’s server backward-compatible by force of optimism.

It also does not choose your API design for you. You still need to decide whether a `404` is useful, whether a list should paginate, and how errors should look. In fact, typed clients make fuzzy API decisions more visible, which is occasionally inconvenient and usually healthy.

A few habits keep the setup boring in the best way:

- Export the type from the final, fully mounted app—not from a half-built router.
- Keep the client’s base URL explicit. `/api` in development and `https://api.example.com` in production are different deployment choices, not type-system choices.
- Use `response.ok` (or status-specific handling) before reading a success-shaped body.
- Test the HTTP routes too. Inference proves that TypeScript agrees with itself; it cannot prove that authentication, databases, or proxies behave.

## A good fit for the small-to-medium API

I reach for Hono RPC when a product has one TypeScript backend and one or more TypeScript web clients, especially when the API changes often. It removes a remarkable amount of “what was this field called again?” work without asking everyone to adopt a huge framework.

If your API is public, spans many languages, or needs a formal independently published contract, OpenAPI or another schema-first approach may still be a better center of gravity. There is no prize for using the most clever transport.

The real win is simpler: the route handler becomes a source of truth, the frontend gets a helpful map, and you get to spend a little less time translating your own code back to yourself.
