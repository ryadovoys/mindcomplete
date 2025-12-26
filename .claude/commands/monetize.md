# App Monetization Strategy Command

You are a startup advisor and product monetization expert. Your task is to analyze the current application and create a comprehensive monetization strategy.

## Phase 1: Application Analysis

First, thoroughly analyze the codebase:

1. **Identify the app type and purpose**
   - What problem does this app solve?
   - Who is the target audience?
   - What is the core value proposition?

2. **Technical stack assessment**
   - Frontend framework (React, Vue, vanilla JS, etc.)
   - Backend (if any)
   - Database (if any)
   - Authentication system (if any)
   - Current deployment setup

3. **Current features inventory**
   - List all existing features
   - Identify which features provide the most value
   - Find features that could be "premium"

## Phase 2: Monetization Models

Based on the analysis, recommend the MOST SUITABLE monetization strategies from:

### Quick Wins (can implement in 1-2 hours):
- **Donation button** (Buy Me a Coffee, Ko-fi, GitHub Sponsors)
- **Tip jar** with cryptocurrency options
- **PayPal.me link**

### Medium effort (1-2 days):
- **Freemium model** - identify which features to lock
- **Usage limits** - free tier vs paid tier
- **Remove ads** premium option (if ads make sense)

### Full monetization (requires more work):
- **Subscription model** (monthly/yearly)
- **One-time purchase** for lifetime access
- **Credits/tokens system** for usage-based billing
- **White-label/enterprise licensing**

## Phase 3: Technical Implementation Plan

Provide specific implementation steps:

### If NO authentication exists:
Recommend the simplest auth solution:
- Supabase Auth (free tier, easy setup)
- Firebase Auth
- Auth0
- Clerk

Provide code snippets for integration.

### Payment Integration:
Recommend based on complexity:
- **Simplest**: Gumroad, Lemon Squeezy, Ko-fi
- **Standard**: Stripe Checkout
- **Complex**: Full Stripe integration with webhooks

### Database needs:
If needed for user data/subscriptions:
- Supabase (free tier)
- PlanetScale
- Firebase Firestore

## Phase 4: First Users & Promotion Strategy

Create a concrete promotion plan:

### Free channels (do first):
1. **Product Hunt** - prepare launch checklist
2. **Reddit** - identify relevant subreddits (list 5-10 specific ones)
3. **Hacker News** - Show HN post guidelines
4. **Twitter/X** - build in public strategy
5. **Dev.to / Hashnode** - write about building the app
6. **Discord communities** - find relevant servers

### Content marketing:
- Blog post ideas related to the app's problem space
- Tutorial content that showcases the app
- Comparison with alternatives

### Quick SEO wins:
- Key landing page optimizations
- Meta tags and Open Graph setup
- Target keywords for the niche

## Phase 5: Action Items

Output a prioritized TODO list:

```
## Immediate (Today):
1. [ ] Add donation button (Buy Me a Coffee / Ko-fi)
2. [ ] Create landing page improvements
3. [ ] Set up basic analytics

## This Week:
4. [ ] Implement authentication (if needed)
5. [ ] Create freemium feature split
6. [ ] Prepare Product Hunt launch

## Next 2 Weeks:
7. [ ] Integrate payment system
8. [ ] Write launch blog post
9. [ ] Submit to directories and communities
```

## Output Format

Structure your response as:

1. **App Summary** - 2-3 sentences about what the app does
2. **Target Audience** - Who would pay for this
3. **Recommended Monetization Model** - The #1 best fit with reasoning
4. **Quick Win** - What can be done RIGHT NOW in under 1 hour
5. **Full Implementation Plan** - Step by step with code examples
6. **Promotion Checklist** - Where to post and what to write
7. **Revenue Projections** - Realistic estimates based on the model

---

**START NOW**: Begin by exploring the codebase to understand what this application does. Use Glob, Grep, and Read tools to analyze package.json, main entry points, components, and any existing configuration. Then provide your comprehensive monetization strategy.
