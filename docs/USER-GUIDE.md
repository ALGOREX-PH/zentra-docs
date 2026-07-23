# Zentra — User Guide

A step-by-step guide for people who have never used a Stellar wallet.

The app lives at **https://zentra-docs.vercel.app**. You need a desktop or laptop
browser (Chrome, Brave, Firefox or Edge) and about ten minutes.

Contents:

1. [What Zentra is](#1-what-zentra-is)
2. [Before you start](#2-before-you-start)
3. [Set up a wallet](#3-set-up-a-wallet)
4. [Get free test XLM](#4-get-free-test-xlm)
5. [Your first transaction](#5-your-first-transaction)
6. [Record an action on-chain](#6-record-an-action-on-chain)
7. [Try the ZK playground](#7-try-the-zk-playground)
8. [Leave feedback](#8-leave-feedback)
9. [Join the programme](#9-join-the-programme)
10. [Troubleshooting](#10-troubleshooting)
11. [Safety](#11-safety)
12. [Getting help](#12-getting-help)

---

## 1. What Zentra is

Software agents are starting to spend money on their owner's behalf — paying an
invoice, topping up a service, settling a bill. The problem is trust. You can
tell an agent "never pay anyone outside this list, and never spend more than
this per day", but once it is running you have no way to check that it obeyed.
Zentra's answer is simple: **the money does not move until the agent has proved
it followed the rules.** The rules are checked by a program on a public ledger,
not by the agent itself, so the agent cannot mark its own homework.

The awkward part is that your rules are usually private. You do not want to
publish your suppliers or your spending limits just to prove you stayed inside
them. Zentra uses a **zero-knowledge proof** — a piece of maths that lets
someone prove a statement is true without revealing why it is true. The everyday
analogy: you can prove you are over eighteen by showing a stamp on your hand
from the bouncer who already checked, without showing your date of birth, your
address, or your name. In Zentra, the agent proves "this payment obeys my
owner's rules" while the rules themselves stay secret.

This website is where you can try the pieces of that system that are live today:
a working Stellar wallet page, an on-chain message board, and a playground that
generates a real zero-knowledge proof inside your browser.

---

## 2. Before you start

**Everything here runs on the Stellar test network. No real money is involved at
any point.**

Read that again, because it is the most important thing on this page:

- The test network is a full copy of the Stellar payment network, run so that
  developers can experiment. It is completely separate from the real one.
- The coins you will use are called **test XLM**. They are given away free by a
  faucet, they cannot be bought or sold, and they are worth nothing.
- You cannot accidentally spend real money in this app. It never asks for a card,
  a bank account, or real cryptocurrency.
- If something goes wrong, the worst outcome is that a worthless test coin moves
  somewhere you did not intend.

Two words you will see repeatedly:

- **XLM** (also called a "lumen") — the built-in coin of the Stellar network. On
  the test network it is free.
- **Testnet** / **Test Net** — the name of the practice network. Your wallet has
  a switch for this, and it must be set to Test Net for the app to work.

The test network is also reset by its operators from time to time. If that
happens, balances and history disappear. That is normal and costs you nothing.

---

## 3. Set up a wallet

A **wallet** is a browser extension that holds your account key and signs
transactions. Zentra never sees your key: every transaction is handed to your
wallet, you approve it there, and only the approved result comes back to the
page.

The app recommends **Freighter**, and the on-page guide at
[`/app`](https://zentra-docs.vercel.app/app) walks through the same three steps
under the heading **GET STARTED · 3 STEPS**.

### Install Freighter

1. Go to **https://www.freighter.app/** and install the extension for your
   browser. Only install it from that address — extensions with similar names
   exist and some are fake.
2. Open the extension and choose to create a new wallet.
3. Set a password. This password unlocks the extension on this computer only.

### Save your recovery phrase

4. Freighter shows you a **recovery phrase** — a list of ordinary words in a
   fixed order. This phrase *is* your account. Anyone who has it controls
   everything in the account, on every network, forever.
5. Write it down on paper and keep it somewhere private. Do not photograph it,
   do not put it in a chat message, an email, or a notes app that syncs.
6. **Never give the phrase to anyone.** No one from Zentra will ever ask you for
   it — not by email, not on GitHub, not in any support conversation. Any
   message asking for it is a theft attempt, no matter who it appears to be
   from. Zentra has no support channel that could ever need it.
7. Confirm the phrase when Freighter asks you to re-enter the words.

### Switch to the test network

8. Open the Freighter extension and find its network selector.
9. Choose **Test Net**. This is the step people forget; the app cannot work
   without it.
10. Go back to https://zentra-docs.vercel.app/app and reload the page.

### Connect

11. Press **Connect Wallet** in the top right of the page.
12. A window listing the supported wallets appears. Choose your wallet and
    approve the connection request that pops up.
13. When it works, the button is replaced by your shortened address (something
    like `GABC…WXYZ`) next to a **Disconnect** button, and the setup panel
    collapses to the line *Wallet connected on testnet. Setup done.* A
    **Need help?** button brings the three steps back.

Your address is public information. It starts with `G`, is 56 characters long,
and is safe to share — it is how people send you test XLM.

### Other supported wallets

Freighter is the recommended path and the one the app defaults to, but the
connection window also offers:

| Wallet | Type |
| --- | --- |
| Freighter | Browser extension (recommended) |
| xBull | Browser extension / web wallet |
| Albedo | Web-based signer |
| Lobstr | Wallet app with browser connection |
| Hana | Browser extension |
| Rabet | Browser extension |

Whichever you choose, it must be set to the Stellar test network. If you connect
one of the alternatives and later reload the page, it is safest to press
**Disconnect** and connect again rather than assuming the old session still
points at the right wallet.

---

## 4. Get free test XLM

A brand-new Stellar account does not exist on the network until something funds
it. The free faucet that does this is called **Friendbot**.

1. Go to [`/app`](https://zentra-docs.vercel.app/app) with your wallet
   connected.
2. Look at the panel headed **TESTNET BALANCE** on the left.
3. If your account has never been funded, it says *This account isn't funded on
   testnet yet.* with a button underneath: **Fund with Friendbot**.
4. Press it. The button changes to **Funding…** while it works.
5. After a few seconds the panel switches to your balance — a large number
   followed by **XLM**, your shortened address, and two buttons, **Refresh** and
   **Fund**.

What to expect:

- Friendbot decides how much it gives; the amount is set by Stellar, not by
  Zentra, and it is far more than you need for anything in this guide.
- The whole thing normally takes a few seconds. If the network is busy it can
  take longer; press **Refresh** rather than pressing **Fund** repeatedly.
- Pressing **Fund** on an account that already exists usually does nothing
  visible. If you see *Friendbot could not fund this account. It may already be
  funded.* that is harmless — press **Refresh** and check the balance.
- Your balance is read live from the test network, so it will not change until a
  transaction actually settles.

---

## 5. Your first transaction

This sends test XLM from your account to another account. It is the same
mechanic as a real Stellar payment, with worthless coins.

You need a destination address. Options:

- Ask someone else who has set up a testnet account for their `G…` address.
- Create a second account in Freighter and use its address (fund it with
  Friendbot first — see the note in the troubleshooting table about
  *The destination account does not exist*).

Then:

1. Go to [`/app`](https://zentra-docs.vercel.app/app) and make sure your address
   is showing in the top right.
2. Find the panel headed **SEND XLM**. Underneath it says *Sends native XLM on
   the Stellar testnet.*
3. In the **Destination** field, paste the recipient's address. It must start
   with `G`. If it is malformed, a red line appears: *Enter a valid G… testnet
   address*.
4. In the **Amount** field, type a small number such as `1`. Whole numbers and
   decimals are both fine, up to seven decimal places. Bad input shows *Enter a
   positive amount (max 7 decimals)*.
5. Press **Send XLM**. The button reads **Sending…** while it is working.
6. Watch the status line under the button. It moves through three phases:
   - *Building transaction…* — the page is preparing the payment.
   - *Awaiting signature in your wallet…* — this is your cue to look at the
     wallet.
   - *Submitting to testnet…* — the signed payment has been sent to the network.
7. When the second phase starts, your wallet opens a window showing what you are
   about to sign: the network (it should say the test network), the destination
   address, the amount, and the fee. Check the destination matches what you
   typed, then approve it. The exact wording of the approve and reject buttons
   depends on which wallet you use. Rejecting is always safe — nothing is sent.
8. On success a green box appears headed **Payment settled**, with the line
   *Sent 1 XLM.* and a link reading **Tx** followed by a shortened code.
9. Press **Refresh** in the balance panel to see the new balance.

### Reading the result

The **Tx** link opens the transaction on **stellar.expert**, an independent
block explorer. Zentra does not control that site, which is the point: it lets
you verify what happened without trusting this app.

On that page you can check:

- **Status / result** — whether the transaction succeeded.
- **Ledger** — the numbered block it was included in. Stellar closes a ledger
  every few seconds, so a settled payment is final almost immediately.
- **Source** and **operations** — who paid, who was paid, and how much.
- **Fee** — the network charge. It is a tiny fraction of one XLM (0.00001 XLM at
  the standard rate), and on testnet it costs nothing real.

The shortened address next to your balance links to the same explorer, showing
every transaction your account has ever made.

If the payment fails you get a red box headed **Payment failed** with a plain
explanation. Section 10 lists every message it can show and what to do about
each one.

---

## 6. Record an action on-chain

Page: [`/board`](https://zentra-docs.vercel.app/board) — *Record a verifiable
action*.

The **action log** is a small program (a "smart contract") living on the Stellar
test network. Anyone can write a short message into it, and once written the
message is public, permanent, and stamped with the address that wrote it. It is
the simplest possible demonstration of the thing Zentra is built on: an action
that can be checked by anyone, later, without trusting whoever performed it.

To post a message:

1. Go to `/board` and press **Connect Wallet** if you are not already connected.
2. In the panel headed **RECORD AN ACTION**, type into the **Message** box. The
   counter under it shows how many of the 200 allowed characters you have used,
   and turns red if you go over.
3. Press **Record on-chain**. It changes to **Recording…**.
4. Approve the transaction in your wallet, exactly as in the previous section.
5. The result box confirms *Action recorded on-chain.* with a **Tx** link to
   stellar.expert. The green heading above it reads **Payment settled** — the
   same result panel is shared with the payment form, so ignore the word
   "payment"; the line beneath it is the accurate one.

The right-hand panel, **LIVE ON-CHAIN FEED**, is the shared log:

- The line at the top shows how many actions have ever been recorded, followed
  by *polling every 6s*.
- The page re-checks the network every six seconds, so messages posted by other
  people appear on their own without a reload. Your own message appears as soon
  as it settles.
- Each entry shows the author's shortened address (a link to their account on
  stellar.expert), a **rep** badge, the entry number, and the ledger it landed
  in.
- **rep** is a reputation score. Recording an action also calls a second,
  separate contract that increases the author's score, so the number grows as an
  address does more.
- Before anyone has posted, the feed reads *No actions yet — be the first to
  record one.*

The shortened contract address in the page header links to the contract itself
on stellar.expert, if you want to inspect it.

---

## 7. Try the ZK playground

Page: [`/playground`](https://zentra-docs.vercel.app/playground) — *Real
zero-knowledge proofs, in your browser.*

### What a proof is here

A **proof** is a small piece of data that convinces a sceptical checker that a
statement is true, while revealing nothing beyond the statement. The statement
this page proves is, roughly: *"this payment was made to an approved supplier,
for an amount within a private limit, and the total spent so far still fits
inside a private daily cap."* The supplier list, the limits and the invoice
never leave your browser. Only the proof and a short list of public values do.

The page explains this before you touch anything, in the panel **NEW TO ZK?
START HERE**, followed by diagrams, and there is a plain-English **ZK GLOSSARY**
at the bottom where each term expands when you tap it.

### Generating a proof

1. Scroll to the panel headed **PROOF LAB** / *Generate a real Groth16 proof*.
2. Press **Generate real proof**. The button reads **Proving…** while it runs.
3. Four stage boxes light up in order: **Load circuit**, **Compute witness**,
   **Generate proof**, **Verify**.

How long it takes varies a lot, and there is no honest single number:

- The first run downloads roughly five to six megabytes of proving files. On a
  fast connection that is a few seconds; on a slow one it can be a minute or
  more. Later runs in the same session are quicker because the files are cached.
- The proving itself is real computation. On a current laptop expect a few
  seconds; on an older machine or a phone it can take considerably longer, and
  on low-memory phones it may fail outright.
- Checking the proof, by contrast, is close to instant — usually a few
  milliseconds.
- The page shows you the real figures when it finishes: *prove Xms · verify Yms*
  in the result panel.

Keep the tab open and in the foreground while it runs. Nothing is sent anywhere
during this step; the whole computation happens on your own machine.

### Reading the result

Three panels appear:

- **THE PROOF · π** — the proof itself, which is only three points on a curve,
  listed as π_a, π_b and π_c, plus a green line reading *Verified locally ·
  valid*. That means your own browser re-checked the proof and it holds.
- **PUBLIC SIGNALS · WHAT THE PROOF REVEALS** — the values the proof does expose,
  such as the recipient, the amount and a one-time tag. Tap any row for a
  one-sentence explanation of what that value means.
- **WHAT THIS PROOF GUARANTEES** and **WHAT STAYS SECRET** — side by side, in
  ordinary sentences: what a checker learns, and what never left your browser
  (the maximum amount, the daily limit, the full supplier list, and the
  invoice).

### Anchoring

The last panel is **ANCHOR ON-CHAIN**.

**Anchoring** means writing a short fingerprint of your proof onto the public
ledger, so that afterwards anyone can see that this exact proof existed at that
moment. It does not publish the proof, and it certainly does not publish your
private inputs — only a fingerprint, the number of public values, and your
address. Think of it as a dated receipt in a public register.

1. Press **Connect Wallet** if the panel says *Connect a wallet to anchor.*
2. Press **Anchor proof on-chain**. The button reads **Anchoring…**.
3. Approve the transaction in your wallet.
4. On success the panel shows *Anchored on-chain* with a **view tx** link to
   stellar.expert.
5. Your entry joins the **PROOFS ANCHORED ON-CHAIN** feed below, showing your
   shortened address, the entry number, how many public values the proof had, the
   ledger, and the fingerprint. The **registry** link opens the contract that
   stores them all.

### The three scenarios

Further down, under *Or replay the three scenarios*, are three small panels you
can play without a wallet. They are scripted replays, not live transactions, and
each shows which safeguard fires:

- **Legitimate payment** — approved supplier, within limits. Outcome: *Settled*.
- **Prompt injection** — someone tricks the agent into paying an attacker who is
  not on the approved list. Outcome: *Blocked at proof* — no valid proof can even
  be produced, so nothing is ever submitted.
- **Over-spend** — the agent lies about how much it has already spent. Outcome:
  *Blocked on-chain* — the proof is well-formed, but the contract compares it
  against the spending recorded on the ledger and rejects the lie.

Press **run scenario** on each; the button becomes **replay** afterwards.

---

## 8. Leave feedback

Page: [`/metrics`](https://zentra-docs.vercel.app/metrics) — *Usage & feedback*.

The top of the page shows live counts read directly from the contracts:
**ON-CHAIN INTERACTIONS**, **DISTINCT WALLETS**, and **NETWORK** (which reads
*Testnet*). The wallet count is sometimes shown with a `+` and the note *lower
bound* — the contracts only return a recent window, so the true number can be
higher.

To leave feedback:

1. In the panel headed **LEAVE FEEDBACK**, choose a star rating from 1 to 5.
2. Write a comment. The limit is 280 characters and a counter tracks it.
3. Press **Send feedback**.
4. If your wallet is connected, the app first asks you to sign a transaction
   that anchors your rating and comment on the test network. Approve it as
   usual. Your feedback is then also saved in the app's database.
5. If no wallet is connected, the anchoring step is skipped and the feedback is
   saved off-chain only. The panel says as much: *Connect a wallet to anchor your
   feedback on-chain — otherwise it's saved off-chain.*
6. On success you see *Thanks — your feedback was recorded.*

Your comment appears in the **WHAT USERS SAY** panel next to the form, with the
average rating and the number of reviews. Anchored reviews carry an **on-chain**
badge linking to their transaction on stellar.expert, so anyone can confirm the
rating was really submitted by that address.

Feedback submissions are limited to five in ten minutes from the same
connection. Beyond that you get *Too many requests.* — wait and try again.

Anything you write here is public. Do not put personal details in the comment,
and remember that an anchored comment is on a public ledger permanently and
cannot be edited or deleted.

---

## 9. Join the programme

Page: [`/join`](https://zentra-docs.vercel.app/join) — *Join the testnet
programme*.

The team is onboarding the first 50 people to try Zentra and report where it
breaks. The panel at the top shows how many have registered so far. Everything
in the programme is on the test network; there is nothing to buy and no real
funds are involved.

The form, headed **REGISTER**, collects:

| Field | Required | Why it is asked |
| --- | --- | --- |
| **Name** | Yes | So replies can address you properly. Up to 80 characters. |
| **Email** | Yes | The only way to contact you about the programme. |
| **Stellar wallet** | Yes | Your public `G…` testnet address, so your registration can be matched with your on-chain activity. It autofills if you have a wallet connected — the hint under the field tells you which case you are in — and you can type a different address instead. |
| **Rating (optional)** | No | A quick 1-to-5 star score for the product so far. |
| **Note (optional)** | No | What you are hoping to build. Up to 500 characters; this is the main input into what gets built next. |

Then press **Join the testnet programme**. On success the panel is replaced by
**YOU ARE ON THE LIST**, with shortcuts to **Open the testnet app** and **Try the
playground**. If you have registered before you will see *You are already
registered — thanks.*, which means you are on the list and nothing more is
needed.

About your email, in the app's own words: *Your email is used only to contact you
about the Zentra testnet programme. It is never displayed publicly, never shown
alongside your wallet, and never sold or shared.* Only your wallet address and
your rating are ever used in public counts — never your name or your email.

Two limits worth knowing: registration is capped at three attempts every ten
minutes from the same connection, and there is currently no self-service way to
delete your registration. If you want your details removed, open an issue or
contact the team through the repository linked in section 12.

---

## 10. Troubleshooting

Every message below is one the app can genuinely show you.

### Wallet and connection

| What you see | What it means | What to do |
| --- | --- | --- |
| Pressing **Connect Wallet** opens a list, but your wallet is not usable in it | The extension is not installed, is locked, or the browser has not seen it yet | Install the wallet, unlock it with your password, then reload the page and try again |
| Nothing happens at all after choosing a wallet | The approval window was dismissed, or the extension is blocked in a private/incognito window | Try again in a normal window and approve the connection request |
| Your wallet warns about a network mismatch, or refuses to sign | Your wallet is set to the main Stellar network, not the test network | Open the wallet, switch the network to **Test Net**, reload the page, and reconnect |
| After reloading, signing opens the wrong wallet or fails | The saved session defaults back to Freighter | Press **Disconnect**, then **Connect Wallet**, and pick your wallet again |
| *Connect your wallet first.* | You submitted a form with no wallet connected | Press **Connect Wallet** at the top of the page |
| *You declined the signature in your wallet.* | You pressed the reject button, or the wallet window was closed | Nothing was sent. Repeat the action and approve it this time |

### Funding and balances

| What you see | What it means | What to do |
| --- | --- | --- |
| *This account isn't funded on testnet yet.* | The account exists in your wallet but has never been created on the network | Press **Fund with Friendbot** |
| *Friendbot could not fund this account. It may already be funded.* | The faucet declined, usually because the account already exists | Press **Refresh**. If the balance is there, nothing is wrong. Otherwise wait a minute and try again |
| The balance does not change after a payment | The panel does not poll continuously | Press **Refresh** |
| *Loading balance…* never finishes | The network connection to Stellar stalled | Reload the page and try again in a moment |

### Sending a payment

| What you see | What it means | What to do |
| --- | --- | --- |
| *Enter a valid G… testnet address* | The destination is not a valid Stellar address | Paste it again. It starts with `G` and is 56 characters, all uppercase letters and digits. Check for a missing character or a stray space |
| *Enter a positive amount (max 7 decimals)* | The amount is empty, zero, negative, or too precise | Use a plain positive number such as `1` or `2.5` |
| *Fix the highlighted fields.* | The form was submitted with an invalid destination or amount | Correct the fields showing red text |
| *The destination account does not exist on testnet — fund it first.* | On Stellar, an account has to be created before it can receive anything | Have the recipient fund their account with Friendbot (they can use the **Fund with Friendbot** button on `/app`), then send again |
| *Not enough XLM to cover the amount plus the network fee.* | The total of amount plus fee exceeds your balance | Send a smaller amount, or fund your account again |
| *Not enough XLM in your account for this payment.* | Same cause, reported by the payment step | Send less. Note that every Stellar account must keep a small reserve, so you can never send your entire balance |
| *The transaction sequence was stale. Please try again.* | Two transactions were prepared at once, or an old one was retried | Simply press the button again |
| *Network rejected the transaction (…)* | The network refused it for another reason; the code in brackets is the technical detail | Reload the page and retry. If it repeats, copy the code into a GitHub issue (section 12) |
| Stuck on *Submitting to testnet…* | The network is slow to respond | Wait up to a minute. If nothing changes, reload and check the account on stellar.expert before resending — the payment may already have gone through |

### Board, playground and feedback

| What you see | What it means | What to do |
| --- | --- | --- |
| *Enter a message between 1 and 200 characters.* | The message is empty or too long | Adjust it; the counter under the box shows the length |
| *Could not load the on-chain feed.* | The connection to the test network failed | Reload the page in a moment. The test network occasionally has outages |
| *Could not load the proof registry.* / *Could not load on-chain stats.* | Same cause, on a different page | Same fix |
| The proof is slow to generate | Normal. The first run downloads several megabytes and the computation itself takes seconds, longer on old machines and phones | Keep the tab open and in the foreground. Prefer a desktop browser. Expect anywhere from a few seconds to a minute or more depending on machine and connection |
| *Proof generation failed.* / *Proof worker error.* | The browser ran out of memory, or the tab was suspended | Close other tabs, use a desktop browser, and try again |
| *Could not load the circuit input.* | A file needed for proving did not download | Reload the page and press **Generate real proof** again |
| *Connect a wallet to anchor.* | Anchoring writes to the network, so it needs a signature | Press **Connect Wallet** in that panel |
| *Pick a rating (1–5) and a comment up to 280 characters.* | The feedback form is incomplete | Choose a star rating and shorten the comment if needed |
| *Too many requests.* | You hit the rate limit — five feedback submissions or three registrations per ten minutes | Wait ten minutes and try again |
| *Enter a Stellar account id — G followed by 55 characters.* | The wallet field on `/join` is not a valid address | Copy the address from your wallet, or connect the wallet to autofill it |
| *You are already registered — thanks.* | Not an error: this email or wallet is already on the list | Nothing to do |

---

## 11. Safety

- **Your recovery phrase is the account.** Anyone who reads it can take
  everything in it, on any network, permanently. Keep it offline and private.
- **Zentra will never ask for your recovery phrase or your wallet password.**
  Nobody legitimate ever will. Any message, site, form or person asking for it is
  attempting theft, however convincing the branding looks.
- **The app never holds your keys.** There is no Zentra account, no password to
  create, and no server-side signing. Every transaction is built in your browser,
  handed to your wallet, and only signed if you approve it there. If you reject
  it, nothing happens.
- **Read what you sign.** Before approving, check the destination address and the
  amount in the wallet window, not just on the page.
- **This is the test network.** The coins are free and worthless, and the network
  may be reset without notice. Do not treat anything here as a store of value,
  and do not reuse a testnet wallet for real funds if you can avoid it — keep
  practice accounts separate from anything that matters.
- **This is unaudited, pre-release software.** It has not been through a
  third-party security review. It is published so people can try it and report
  problems. Treat it as an experiment.
- **On-chain writing is public and permanent.** Messages on `/board`, anchored
  feedback, and anchored proofs are visible to anyone forever and cannot be
  edited or removed. Do not write anything private, personal, or sensitive.
- **Only use the official address**, https://zentra-docs.vercel.app, and install
  Freighter only from https://www.freighter.app/.

---

## 12. Getting help

- **Repository:** https://github.com/ALGOREX-PH/zentra-docs
- **Report a problem or ask a question:**
  https://github.com/ALGOREX-PH/zentra-docs/issues

When reporting a problem, it helps to include: which page you were on, the exact
message you saw, which wallet and browser you used, and the transaction link if
one was produced. Never include your recovery phrase — it is never needed to
diagnose anything.

Elsewhere on the site: [`/docs`](https://zentra-docs.vercel.app/docs) is the
technical documentation for developers,
[`/roadmap`](https://zentra-docs.vercel.app/roadmap) shows what is live today and
what is planned, and [`/blog`](https://zentra-docs.vercel.app/blog) carries
release notes and deeper write-ups.
