# Handovr.ai

Handovr is an AI referee for freelance web work. The client and the freelancer agree a checklist of what "done" means and both sign it. PayPal holds the client's payment while the work is done. When the freelancer submits the site, Claude tests it in a real browser against the signed checks. If everything passes, the money is released; if attempts run out, Handovr proposes a fair split; if either side declines, the hold goes back to the client.

## Try it

The app is live at **https://handovr-drxq.onrender.com**. It runs on PayPal's sandbox, so no real money moves.

To look around without signing in, press **Continue as a client** or **Continue as a freelancer** on the sign-in page. The demo projects show every stage: a paid milestone, one waiting for review, one being tested, a list with suggested changes and one still being drafted. Open a project to see its timeline, and the **Ledger** to see every PayPal event.

To run a milestone yourself, sign in with PayPal using the two sandbox accounts made for judging. They hold sandbox money only.

| Role | PayPal sandbox email | Password |
|---|---|---|
| Client | judge1@gmail.com | NQQAx*04 |
| Freelancer | judge2@gmail.com | 1rNl^6fD |

1. Sign in as the client and create a new project. Use the freelancer's email above under "Who is doing the work?".
2. Handovr drafts the checks. Read them, change anything, and sign. Sign in as the freelancer in another browser and sign too.
3. As the client, fund the first milestone. PayPal holds the amount plus its fee.
4. As the freelancer, submit `https://handovr-drxq.onrender.com/fixtures/good/index.html` to watch it pass, or `/fixtures/dead-form/index.html` to watch a check fail.
5. Follow the test live, review anything left for the client, and see the payment released in the ledger.

## How it works

- **Contract.** Claude drafts testable checks from each milestone brief, with a share of the payment on each. Either person can change them; the other must accept the change. Both sign by typing their name.
- **Hold.** Funding creates a PayPal order with intent `AUTHORIZE`. The client pays PayPal's fee on top, so the freelancer receives the whole milestone amount. A hold lasts 29 days and is renewed once on day 25.
- **Testing.** Claude drives a KERNEL cloud browser with tools to open pages, click, type, change the screen size, time page loads, check links and run an accessibility audit. Each check gets a verdict with screenshots and notes as evidence. A failed check is run twice; two fails make a fail, a disagreement goes to the client.
- **Review.** Checks only a person can judge, and unclear ones, go to the client, who approves or sends the work back. If the client does nothing, the work is approved when the review window ends.
- **Release.** Handovr captures the hold and sends the freelancer a PayPal payout.
- **Split.** After four attempts, Handovr splits the payment by the share of the checks that passed. Code does the arithmetic; Claude explains it in plain words. Both must accept; either can decline, and the hold is returned.
- **Safety.** Every state change goes through one state machine. Money work is written to an outbox and sent with idempotency keys, so a retry can never pay twice. Webhooks are checked with PayPal and only prompt Handovr to re-read the payment. A tick every five minutes renews holds, ends review windows and resumes stalled work.

## Sponsor tools

| Tool | Where it is used |
|---|---|
| PayPal | Log in with PayPal, Orders (authorise, reauthorise, capture, void), Payouts and webhooks |
| Anthropic Claude | Drafting and rewriting checks, testing sites with tools, explaining splits |
| KERNEL | The cloud browser Claude tests in, with a replay of each run |
| Zapier MCP | Notification emails through Gmail at each step |
| AG Grid and AG Charts | The ledger table and the weekly money chart |
| Bryntum Gantt | The project timeline |
| Render | Hosting for the app and its Postgres database |

`postman/handovr-paypal.postman_collection.json` holds every PayPal call Handovr makes, in order, with the same headers and bodies.

## Run it locally

You need Node 22, pnpm and PostgreSQL.

```bash
pnpm install
cp .env.example .env.local
initdb -D .pgdata
pnpm db:start
createdb -h localhost -p 5433 handovr
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Fill `.env.local` with your PayPal sandbox app, Anthropic and KERNEL keys, then open http://127.0.0.1:3000. PayPal login returns to `127.0.0.1`, so use that address rather than `localhost`.

## Tests

```bash
pnpm test
```

The tests run against an in-memory Postgres (PGlite). To measure how well the tester judges known sites:

```bash
pnpm eval:verification -- --base https://handovr-drxq.onrender.com/fixtures/ --models claude-sonnet-5-5
```

## Limits

- Canadian dollars and the PayPal sandbox only.
- A hold lasts 29 days with one renewal; a milestone that runs past that lapses and can be started again.
- Drafting, rewriting and test runs have daily limits per account and overall, so the public demo stays affordable.

## Licence

MIT. See `LICENSE`.
