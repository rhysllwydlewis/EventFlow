(function(h){"use strict";const p={apiBaseUrl:"",authToken:"",assistantName:"Jade",greetingText:"Hi! 👋 I'm Jade, your event planning assistant. Can I help you plan your special day?",greetingTooltipText:"👋 Hi! Need help planning your event?",avatarUrl:"https://cdn.jsdelivr.net/gh/rhysllwydlewis/JadeAssist@main/packages/widget/assets/avatar-woman.png",primaryColor:"#0B8073",accentColor:"#13B6A2",fontFamily:'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',showDelayMs:1e3,offsetBottom:"80px",offsetRight:"24px",offsetLeft:"",offsetBottomMobile:"",offsetRightMobile:"",offsetLeftMobile:"",scale:1,debug:!1},l={STATE:"jade-widget-state",MESSAGES:"jade-widget-messages",CONVERSATION_ID:"jade-widget-conversation-id",GREETING_DISMISSED:"jade-widget-greeting-dismissed",SOUND_ENABLED:"jade-widget-sound-enabled",SOUND_VOLUME:"jade-widget-sound-volume"};class d{static saveState(e){try{const s={...this.loadState(),...e};localStorage.setItem(l.STATE,JSON.stringify(s))}catch(t){console.warn("Failed to save widget state:",t)}}static loadState(){try{const e=localStorage.getItem(l.STATE);return e?JSON.parse(e):{}}catch(e){return console.warn("Failed to load widget state:",e),{}}}static saveMessages(e){try{localStorage.setItem(l.MESSAGES,JSON.stringify(e))}catch(t){console.warn("Failed to save messages:",t)}}static loadMessages(){try{const e=localStorage.getItem(l.MESSAGES);return e?JSON.parse(e):[]}catch(e){return console.warn("Failed to load messages:",e),[]}}static saveConversationId(e){try{localStorage.setItem(l.CONVERSATION_ID,e)}catch(t){console.warn("Failed to save conversation ID:",t)}}static loadConversationId(){try{return localStorage.getItem(l.CONVERSATION_ID)}catch(e){return console.warn("Failed to load conversation ID:",e),null}}static clearAll(){try{localStorage.removeItem(l.STATE),localStorage.removeItem(l.MESSAGES),localStorage.removeItem(l.CONVERSATION_ID),localStorage.removeItem(l.GREETING_DISMISSED)}catch(e){console.warn("Failed to clear storage:",e)}}static isGreetingDismissed(){try{return localStorage.getItem(l.GREETING_DISMISSED)==="true"}catch(e){return console.warn("Failed to check greeting dismissed state:",e),!1}}static setGreetingDismissed(){try{localStorage.setItem(l.GREETING_DISMISSED,"true")}catch(e){console.warn("Failed to save greeting dismissed state:",e)}}static loadSoundEnabled(){try{const e=localStorage.getItem(l.SOUND_ENABLED);return e===null?!1:e==="true"}catch(e){return console.warn("Failed to load sound enabled state:",e),!1}}static saveSoundEnabled(e){try{localStorage.setItem(l.SOUND_ENABLED,String(e))}catch(t){console.warn("Failed to save sound enabled state:",t)}}static loadSoundVolume(){try{const e=localStorage.getItem(l.SOUND_VOLUME);if(e===null)return .5;const t=parseFloat(e);return isNaN(t)?.5:Math.min(1,Math.max(0,t))}catch(e){return console.warn("Failed to load sound volume:",e),.5}}static saveSoundVolume(e){try{localStorage.setItem(l.SOUND_VOLUME,String(e))}catch(t){console.warn("Failed to save sound volume:",t)}}}class b{constructor(e,t){this.demoState={},this.baseUrl=e||"",this.authToken=t||"",this.demoMode=!e}async sendMessage(e,t){var i;if(this.demoMode)return this.mockResponse(e);const s={"Content-Type":"application/json"};this.authToken&&(s.Authorization=`Bearer ${this.authToken}`);const n=await fetch(`${this.baseUrl}/api/widget/chat`,{method:"POST",headers:s,body:JSON.stringify({message:e,conversationId:t,userId:"anonymous"})});if(n.status===429)throw new Error("429: Rate limit exceeded. Please wait and try again.");if(n.status===401||n.status===403)throw new Error(`${n.status}: Authentication failed.`);if(!n.ok)throw new Error(`API error: ${n.status}`);const a=await n.json();if(!a.success||!a.data)throw new Error(((i=a.error)==null?void 0:i.message)||"API request failed");return{conversationId:a.data.conversationId,message:{id:a.data.message.id,role:"assistant",content:a.data.message.content,timestamp:Date.now(),quickReplies:a.data.suggestions}}}async mockResponse(e){await new Promise(i=>setTimeout(i,700+Math.random()*400));const t="demo-"+Date.now(),s=e.toLowerCase();this.updateDemoState(s);const{content:n,quickReplies:a}=this.buildDemoResponse(s);return{conversationId:t,message:{id:"msg-"+Date.now(),role:"assistant",content:n,timestamp:Date.now(),quickReplies:a}}}updateDemoState(e){e.includes("wedding")||e.includes("civil partnership")?this.demoState.eventType="wedding":e.includes("birthday")?this.demoState.eventType="birthday":e.includes("corporate")||e.includes("away day")||e.includes("away-day")||e.includes("work event")?this.demoState.eventType="corporate":e.includes("conference")||e.includes("seminar")?this.demoState.eventType="conference":e.includes("anniversary")?this.demoState.eventType="anniversary":(e.includes("party")||e.includes("celebration"))&&(this.demoState.eventType="party"),/under\s*[£$]?5k\b/i.test(e)||/under\s*£?5,000\b/.test(e)?this.demoState.budget="under £5,000":/\b[£$]?50k\b|\b50,000\b/.test(e)?this.demoState.budget="£50,000+":/\b[£$]?20k\b|\b20,000\b/.test(e)?this.demoState.budget="£20,000–£50,000":/\b[£$]?10k\b|\b10,000\b/.test(e)?this.demoState.budget="£10,000–£20,000":/\b[£$]?5k\b|\b5,000\b/.test(e)&&(this.demoState.budget="£5,000–£10,000");const t=/\b(\d{1,3}(?:,\d{3})*|\d+)\s*(guests?|people|attendees?|pax)\b/.exec(e);t?this.demoState.guestCount=t[1].replace(/,/g,""):e.includes("under 30")||e.includes("intimate")?this.demoState.guestCount="20–30":(e.includes("150+")||e.includes("large"))&&(this.demoState.guestCount="150+"),e.includes("london")?this.demoState.location="London":e.includes("scotland")||e.includes("edinburgh")||e.includes("glasgow")?this.demoState.location="Scotland":e.includes("wales")||e.includes("cardiff")?this.demoState.location="Wales":e.includes("north west")||e.includes("manchester")||e.includes("liverpool")?this.demoState.location="North West":e.includes("yorkshire")||e.includes("leeds")||e.includes("sheffield")?this.demoState.location="Yorkshire":e.includes("south east")||e.includes("surrey")||e.includes("kent")||e.includes("sussex")?this.demoState.location="South East":e.includes("midlands")||e.includes("birmingham")?this.demoState.location="Midlands":(e.includes("south west")||e.includes("bristol")||e.includes("cornwall")||e.includes("devon"))&&(this.demoState.location="South West"),e.includes("this year")?this.demoState.eventDate="this year":e.includes("next year")&&(this.demoState.eventDate="next year")}buildDemoResponse(e){const t=this.demoState;if((e.includes("yes")&&e.includes("please")||e==="help"||e==="start"||e==="hi"||e==="hello"||e==="hey")&&!t.eventType)return{content:"I'd love to help you plan your event! What type of event are you organising? 🎉",quickReplies:["Wedding","Birthday Party","Corporate Event","Anniversary","Other"]};if(e.includes("no")&&e.includes("thanks"))return{content:"No problem — I'm here whenever you're ready. Feel free to come back any time! 😊"};if(e.includes("wedding")||t.eventType==="wedding")return e.includes("cost")||e.includes("price")||e.includes("budget")||e.includes("expensive")||e.includes("afford")?{content:`Here's a realistic cost breakdown for a wedding in ${t.location||"the UK"}:

**Average UK wedding: £30,000** (range: £8,000 to £100,000+)

**Typical category breakdown:**
- **Venue**: £3,000–£15,000 (London/South East at the top end)
- **Catering & bar**: £65–£150/head
- **Photography**: £1,500–£4,000
- **Videography**: £1,200–£3,500
- **Flowers & décor**: £2,000–£8,000
- **Band or DJ**: £800–£3,500
- **Dress**: £500–£5,000
- **Suit/attire**: £300–£1,500
- **Stationery**: £200–£800
- **Wedding cake**: £400–£1,200
- **Transport**: £300–£800

**Biggest cost-saving opportunities:**
1. Choose a Friday or Sunday — venues often charge 20–40% less
2. Book a dry hire venue and bring your own caterer
3. Go for a buffet or sharing platters rather than silver service
4. Limit the evening guest list to reduce per-head costs

What's your approximate total budget?`,quickReplies:["Under £10k","£10k–£20k","£20k–£50k","£50k+"]}:e.includes("venue")?{content:`Choosing your venue is the most important early decision — it sets your date, capacity, and overall feel.

**Key questions to ask every venue:**
- Is it licensed for civil ceremonies, or ceremony-only?
- Is it exclusive hire, or will other events run simultaneously?
- Do they have in-house catering (mandatory or optional)?
- What's the alcohol licence / noise curfew?
- Is there on-site accommodation?
- What's the wet weather contingency?

**Popular venue styles in ${t.location||"your area"}:**
- **Country house hotels** — all-in-one convenience, £4,000–£12,000
- **Barns & rural estates** — rustic charm, dry hire from £2,500
- **City hotels** — central for guests, £3,000–£15,000
- **Heritage venues** — museums, galleries, castles

**Pro tip:** Always visit at least 3 venues before committing — and popular dates book 12–18 months ahead.

How many guests are you expecting?`,quickReplies:["Under 50","50–100","100–150","150+"]}:e.includes("photographer")||e.includes("photography")?{content:`Wedding photography is one area where it genuinely pays to invest — you'll have these photos forever.

**Typical UK rates:**
- Budget: £800–£1,500
- Mid-range: £1,500–£2,500
- Premium: £2,500–£4,500+

**What to look for:**
- A portfolio that matches your style (documentary? posed? fine art?)
- Full-day coverage with high-res digital files
- Public liability insurance and backup equipment
- A second shooter for larger weddings

**Red flags:**
- No contract or vague payment terms
- Can't show a full recent gallery (only highlights)
- No backup plan for illness/emergency

**Questions to ask:**
- Can I see a full gallery from a recent wedding?
- What happens if you have an emergency on our day?
- When will we receive our photos?

Where are you based? I can give region-specific advice.`,quickReplies:["London/South East","North of England","Midlands","Scotland/Wales"]}:e.includes("catering")||e.includes("food")||e.includes("menu")?{content:`Food is what guests remember most — it's worth getting right.

**Typical per-head costs (UK):**
- Buffet / food stations: £45–£75/head
- 2-course sit-down: £55–£85/head
- 3-course sit-down: £65–£110/head
- Canapes + 3-course: £80–£130/head
- Premium silver service: £100–£150+/head

**Drinks:** Budget an extra £25–£50/head for a full open bar.

**Popular formats:**
- **Traditional sit-down** — formal, great for larger weddings
- **Sharing platters** — relaxed, sociable, 15–20% cheaper
- **Food stations** — very on-trend and theatrical

**Dietary requirements to address:**
- Vegan/vegetarian (should be a full dish, not an afterthought)
- Halal/Kosher (specialist caterer required)
- Coeliac (dedicated prep area, not just gluten-removed)
- Nut allergies (full allergen awareness)

Is your venue dry hire, or does it have in-house catering?`,quickReplies:["Dry hire venue","In-house catering","Dietary requirements","Drinks packages"]}:e.includes("checklist")||e.includes("timeline")||e.includes("when")?{content:`Here's a milestone-based wedding planning timeline:

**First 4 weeks:**
- Set total budget and draft guest list
- Book venue (most popular venues book 12–18 months ahead)
- Book registrar/officiant

**3–6 months out:**
- Book photographer & videographer
- Book band or DJ
- Order wedding dress/suit (4–6 months for alterations)
- Send save-the-dates
- Book caterer and florist

**2–3 months out:**
- Send formal invitations
- Arrange wedding insurance
- Book hair & make-up
- Plan order of service

**4–6 weeks out:**
- Chase RSVPs, finalise headcount
- Give final numbers to caterer
- Create table plan
- Confirm all suppliers

**Week of the wedding:**
- Confirm day-of schedule with all suppliers
- Prepare supplier payment envelopes
- Delegate key tasks to wedding party 💍`,quickReplies:["Supplier checklist","Budget breakdown","Guest management","Day-of schedule"]}:e.includes("legal")||e.includes("registrar")||e.includes("notice")||e.includes("licence")||e.includes("banns")?{content:`Here are the legal requirements for getting married in the UK:

**England & Wales:**
- Give notice of marriage at your local register office (minimum 28 days before)
- Both parties attend in person; must have lived in the district for 7+ days
- Cost: ~£35 per person
- For a licensed venue: the registrar attends your venue (fee: £400–£600)
- Church of England: banns read in church for 3 consecutive Sundays beforehand

**Scotland (different rules):**
- Submit notice to the registrar at least 29 days before
- More flexibility on outdoor/unlicensed locations

**After the wedding:**
- Collect your marriage certificate from the registrar
- Update passport, driving licence, bank accounts, employer records as needed

Are you getting married in England, Wales, Scotland, or Northern Ireland?`,quickReplies:["England/Wales","Scotland","Northern Ireland","Destination wedding"]}:e.includes("florist")||e.includes("flowers")?{content:`Flowers can transform a space — and costs vary enormously.

**Typical wedding floristry budgets:**
- Budget: £1,000–£2,500 (simple, seasonal flowers)
- Mid-range: £2,500–£5,000
- Premium: £5,000–£15,000+

**Key floral elements:**
- Bridal bouquet: £150–£400
- Bridesmaid bouquets: £60–£120 each
- Buttonholes: £15–£35 each
- Ceremony arch/focal flowers: £500–£3,000
- Table centres: £60–£200 each

**Cost-saving tips:**
- Choose in-season, British-grown flowers
- Use greenery-heavy designs (very stylish and cheaper)
- Repurpose ceremony flowers at the reception
- Opt for potted plants guests can take home

What's your approximate floristry budget?`,quickReplies:["Under £1,000","£1,000–£3,000","£3,000–£6,000","£6,000+"]}:t.eventDate?t.guestCount?t.budget?{content:"What aspect of your wedding would you like to explore?",quickReplies:["Venue advice","Catering & food","Photography","Legal requirements","Planning timeline"]}:{content:"What's your approximate total budget? Don't worry about being exact — a rough range is all I need to start prioritising.",quickReplies:["Under £10k","£10k–£20k","£20k–£50k","£50k+"]}:{content:`Your guest list is the single most important number in wedding planning — it drives your venue choice, catering costs, and almost every supplier quote.

Roughly how many guests are you thinking?

(Average UK wedding: around £30,000 — but great weddings happen at every budget!)`,quickReplies:["Under 30 (intimate)","30–80 (medium)","80–150 (large)","150+ (very large)"]}:{content:`Congratulations! A wedding is such a special occasion — I'd love to help you plan it beautifully. 💍

To start narrowing things down, do you have a date or timeframe in mind?`,quickReplies:["This year","Next year","In 2+ years","Haven't decided yet"]};if(e.includes("birthday")||t.eventType==="birthday")return e.includes("18")||e.includes("eighteenth")?{content:`An 18th birthday is a milestone! Here's what to plan:

**Typical costs (50–100 guests):**
- Venue hire: £300–£2,000
- Catering (buffet/street food): £15–£35/head
- DJ: £300–£800
- Decorations: £150–£500

**Popular formats:**
- **Venue party** (bar, nightclub, function room) — budget £1,500–£5,000 for 50–100 guests
- **Marquee at home** — personal, £2,000–£8,000
- **Restaurant buyout** — intimate, great food, £50–£100/head
- **Activity party** (escape rooms, bowling, go-kart) then dinner

How many guests are you expecting?`,quickReplies:["Under 30","30–60","60–100","100+"]}:e.includes("50")||e.includes("fiftieth")||e.includes("milestone")?{content:`A 50th deserves a proper celebration! These tend to be more sophisticated.

**Popular formats:**
- **Dinner party** (restaurant or private dining room) — intimate, elegant, £60–£120/head
- **Drinks reception + dinner** — £4,000–£12,000 for 60–80 guests
- **Surprise party** — requires a trusted co-conspirator!
- **Destination celebration** — long weekend abroad with close friends

**What makes milestone birthdays memorable:**
- A personalised element (photo montage, custom menu)
- Good music — live jazz, acoustic, or a brilliant playlist
- Quality food over quantity
- A clear "moment" — speeches, a toast, something to mark the occasion

How many people are you inviting?`,quickReplies:["Under 20","20–40","40–80","80+"]}:t.guestCount?{content:`For a birthday party with ${t.guestCount||"your group"}:

**Key things to lock in first:**
1. **Venue** — private dining room, function room, or hired space
2. **Date** — at least 4–6 weeks ahead for a good venue
3. **Catering style** — sit-down, buffet, or street food?

**Typical all-in costs:**
- Budget: £500–£2,000 (DIY elements, small space)
- Mid-range: £2,000–£6,000 (venue + caterer + DJ)
- Premium: £6,000+ (full-service planning)

What's your approximate budget?`,quickReplies:["Under £2k","£2k–£5k","£5k–£10k","£10k+"]}:{content:`A birthday celebration — wonderful! 🎂

The guest list size shapes everything — venue size, catering format, entertainment. Are you thinking intimate or a bigger party?`,quickReplies:["Intimate (under 20)","Small (20–50)","Medium (50–100)","Large (100+)"]};if(e.includes("corporate")||e.includes("away day")||e.includes("away-day")||e.includes("work event")||t.eventType==="corporate")return e.includes("away day")||e.includes("away-day")||e.includes("team building")||e.includes("team day")?{content:`Team away-days done well are genuinely motivating. Here's how to get it right:

**Formats that work:**
- **Activity + debrief** (escape rooms, cooking class, sports) — great for up to 40 people
- **Off-site strategy day** — focuses minds, being away from the office is key
- **Combination day** — morning workshop + afternoon activity + group dinner

**Typical costs:**
- Venue hire (half/full day): £500–£3,000
- Activity (per person): £30–£120
- Catering (working lunch): £20–£45/head
- Evening dinner: £45–£85/head

**What makes them work:**
- Clear objectives shared in advance
- Mix of structured and unstructured time
- Activities that don't exclude anyone (physical ability, dietary needs)
- Quality food — it really matters

How many people in the team?`,quickReplies:["Under 20","20–50","50–100","100+"]}:e.includes("conference")||e.includes("seminar")?{content:`Conferences require detailed logistics. Here's what to focus on:

**Venue requirements:**
- Main plenary room (theatre or cabaret seating?)
- Breakout rooms for parallel sessions
- Registration area with queuing space
- Separate catering areas (noise!)
- A/V booth and tech area
- Green room for speakers

**Technology checklist:**
- PA system + lapel/handheld/podium microphones
- Large-format display or projection
- Reliable WiFi (separate delegate network recommended)
- Live streaming capability if needed

**Typical costs per delegate:**
- Venue + AV: £50–£150/head
- Catering (refreshments + lunch): £35–£75/head

**Key lead times:**
- Venue: 6–18 months depending on size
- Keynote speakers: 3–12 months
- Save-the-date: 3 months before; formal invite 6–8 weeks

How many delegates, and when is the event?`,quickReplies:["Under 50","50–150","150–300","300+"]}:e.includes("product launch")||e.includes("launch")?{content:`Product launches need to create a moment — something worth talking about.

**Core elements:**
1. **Brand-appropriate venue** — the space should reflect the product
2. **A clear story arc** — arrival → reveal → celebration
3. **Media management** — press list, embargo, photography, social plan
4. **Product demo area** — hands-on experience

**Venue considerations:**
- A/V support (blackout, large screens, surround sound)
- Photogenic for press photography
- Central location for press and key guests

**Timeline:**
- T–8 weeks: Confirm venue and A/V
- T–6 weeks: Press list and embargo communications
- T–2 weeks: Full tech rehearsal
- T–1 day: Set up and test everything

How many guests are you inviting?`,quickReplies:["Under 50","50–150","150+","Press-only event"]}:{content:"Corporate events cover a huge range. What type are you planning?",quickReplies:["Conference / seminar","Team away-day","Product launch","Client dinner","Awards evening"]};if(e.includes("anniversary")||t.eventType==="anniversary")return{content:`A beautiful occasion to celebrate! 🥂

**Popular formats:**
- **Intimate dinner** (private dining, £60–£120/head) — elegant and memorable
- **Vow renewal** + reception — popular for 10th, 25th, 50th anniversaries
- **Garden party** — seasonal, relaxed, great for larger groups
- **Surprise party** — requires trusted accomplices!

**Traditional milestones:**
- 10th: Tin · 15th: Crystal · 20th: China · 25th: Silver · 30th: Pearl · 40th: Ruby · 50th: Gold · 60th: Diamond

**What makes it special:**
- Return to the original venue if available
- Recreate the original menu
- Commission a personalised piece of art or jewellery

Is this a milestone anniversary? And are you thinking intimate or a larger gathering?`,quickReplies:["Intimate dinner","Small gathering (20–40)","Larger celebration","Vow renewal"]};if(e.includes("budget")||e.includes("cost")||e.includes("price")||e.includes("how much")||e.includes("expensive")||e.includes("afford"))return{content:`Here are realistic UK cost ranges:

**Weddings:**
- Budget: £10,000–£15,000
- Mid-range: £20,000–£35,000
- Premium: £50,000–£100,000+

**Birthday parties (50 guests):**
- Budget: £1,500–£3,000
- Mid-range: £3,000–£8,000
- Premium: £8,000+

**Corporate events (100 delegates):**
- Half-day: £5,000–£15,000
- Full day + dinner: £15,000–£40,000

**The 3 biggest cost levers:**
1. **Guest count** — adding 20 wedding guests can add £2,000–£4,000
2. **Day of week** — Friday/Sunday vs. Saturday saves 20–30% on the venue
3. **Catering style** — buffet vs. silver service differs by £30–£50/head

What's your approximate budget for ${t.eventType||"an event"}?`,quickReplies:["Under £5k","£5k–£10k","£10k–£20k","£20k–£50k","£50k+"]};if(e.includes("venue")||e.includes("where")&&(e.includes("hold")||e.includes("host"))){const s=t.location||"the UK",n=t.eventType||"your event";return{content:`Finding the right venue is the most critical early decision.

**Key questions to ask every venue:**
- Maximum capacity (seated vs. standing)?
- Exclusive hire, or will other events run simultaneously?
- In-house catering (mandatory or optional)?
- What's included in the hire fee?
- Alcohol licence? Noise curfew?
- Parking / nearby transport?
- Fully accessible?

**Venue styles in ${s}:**
- **Hotels** — convenient, often all-inclusive
- **Country houses / estates** — beautiful settings
- **Barns & agricultural spaces** — character, usually dry hire
- **Civic / heritage buildings** — unique, often great value
- **Restaurants with private rooms** — great for smaller events

**For ${n}:** Visit at least 3 venues before committing. Always get a full written quote including extras. Check the cancellation policy carefully.

How many guests are you planning for?`,quickReplies:["Under 50","50–100","100–150","150+"]}}return e.includes("catering")||e.includes("caterer")||e.includes("food")||e.includes("menu")||e.includes("buffet")?{content:`Food is what guests remember — it's worth getting right.

**Catering styles and typical UK costs:**
- Canapes only (drinks reception): £20–£40/head
- Buffet / sharing platters: £35–£65/head
- BBQ / street food: £30–£55/head
- 2-course sit-down: £55–£85/head
- 3-course sit-down: £65–£110/head
- Premium silver service: £100–£150+/head

**Drinks (budget separately):**
- Wine and beer package: £20–£35/head
- Full open bar (5 hours): £40–£70/head

**Dietary requirements — always ask guests:**
- Vegan/vegetarian (proper dish, not an afterthought)
- Halal (dedicated certified caterer or certified supplier)
- Kosher (specialist caterer required)
- Gluten-free/coeliac (separate prep area)
- Nut allergies (full allergen awareness, labelled dishes)

**Pro tip:** Ask the caterer for a tasting before committing — reputable caterers offer this for weddings and larger events.

What type of event is this for?`,quickReplies:["Wedding catering","Corporate catering","Birthday party food","Dietary requirements"]}:e.includes("photographer")||e.includes("photography")?{content:`Finding the right photographer is crucial — these are memories you'll have forever.

**Typical UK rates:**
- Budget: £800–£1,500
- Mid-range: £1,500–£2,500
- Premium: £2,500–£4,500+

**What to look for:**
- Portfolio showing consistent quality across varied lighting
- Experience with your type of event and venue
- Public liability insurance
- Backup camera (equipment fails)
- Clear contract with delivery timelines

**Questions to ask:**
- Can I see a full gallery from a recent similar event?
- What's your shooting style (documentary, posed, or both)?
- What happens if you're ill on the day?
- Do you offer pre-event shoots?

**Where to find vetted photographers:**
- Hitched.co.uk, Rock My Wedding (weddings)
- Bridebook.com
- SWPP (Society of Wedding & Portrait Photographers)

What region are you in?`,quickReplies:["London/South East","North of England","Midlands","Scotland/Wales"]}:e.includes("florist")||e.includes("flowers")||e.includes("floral")?{content:`Flowers can transform a space — and costs vary enormously.

**Typical wedding floristry budgets:**
- Budget: £1,000–£2,500 (simple, seasonal flowers)
- Mid-range: £2,500–£5,000
- Premium: £5,000–£15,000+

**Key floral elements:**
- Bridal bouquet: £150–£400
- Bridesmaid bouquets: £60–£120 each
- Buttonholes: £15–£35 each
- Ceremony arch: £500–£3,000
- Table centres: £60–£200 each

**Cost-saving tips:**
- Choose in-season, British-grown flowers
- Use greenery-heavy designs (stylish and cheaper)
- Repurpose ceremony flowers at the reception

**What to ask your florist:**
- Can they work within your budget?
- What's in season for your date?
- Do they handle set-up and breakdown?

What's your approximate floristry budget?`,quickReplies:["Under £1,000","£1,000–£3,000","£3,000–£6,000","£6,000+"]}:e.includes("dj")||e.includes("band")||e.includes("music")||e.includes("entertainment")?{content:`Entertainment sets the energy of your event — worth investing in.

**Music options and typical UK costs:**

**DJ:**
- Budget: £300–£600
- Mid-range: £600–£1,200
- Premium: £1,200–£3,000+
- Usually includes: PA system, lighting rig, wireless microphone

**Live band:**
- 3-piece function band: £1,200–£2,500
- 4–5 piece band: £2,000–£4,000
- 6-piece+ (with brass): £3,500–£8,000+
- Most include 2–3 sets + DJ service between sets

**Other popular options:**
- String quartet / jazz trio (ceremony): £600–£1,500
- Solo acoustic act: £300–£700
- Photo booth: £600–£1,200
- Silent disco: £600–£1,500 (great for noise-restricted venues)

**Pro tips:**
- Always see a band live or ask for a recent live video
- Confirm PA and lighting is included
- Check your venue's noise restrictions
- For weddings, confirm they'll learn your first dance song

What type of entertainment are you looking for?`,quickReplies:["DJ only","Live band","Both DJ + band","Ceremony music only"]}:e.includes("timeline")||e.includes("checklist")||e.includes("when should")||e.includes("how far in advance")||e.includes("lead time")?{content:`Here's a planning timeline for ${t.eventType||"your event"}:

**18+ months before:**
- Set budget and guest list
- Secure your venue

**12–18 months before:**
- Book registrar/officiant (if applicable)
- Book photographer and videographer
- Book band or DJ

**6–12 months before:**
- Send save-the-dates
- Book caterer and florist
- Order attire (4–6 months for alterations)
- Book accommodation block for guests

**3–6 months before:**
- Send formal invitations
- Arrange event insurance
- Finalise menu and table layout

**4–8 weeks before:**
- Chase RSVPs, finalise headcount
- Give final numbers to caterer
- Confirm all suppliers

**Week before:**
- Final briefing to all suppliers
- Prepare payments
- Delegate day-of tasks

Would you like a more specific checklist for your event type?`,quickReplies:["Wedding checklist","Corporate event","Birthday party","Supplier checklist"]}:e.includes("insurance")||e.includes("cancel")||e.includes("cancellation")||e.includes("contract")||e.includes("legal")?{content:`Event insurance is often overlooked but genuinely important.

**What good event insurance covers:**
- **Cancellation & rescheduling** (illness, bereavement, adverse weather, venue failure)
- **Supplier failure** (photographer doesn't turn up, caterer goes bust)
- **Public liability** (essential for public or venue-hire events)
- **Personal accident** (injury to guests)

**Typical UK costs:**
- Wedding insurance: £60–£200 (up to £30,000 cancellation cover)
- Corporate event: £100–£500 depending on size

**When to get it:** As soon as you start paying deposits.

**Recommended providers:**
- Dreamsaver, Wedinsure (wedding specialists)
- John Lewis Finance (event insurance)
- Hiscox (corporate events)

**Contract tips:**
- Every supplier needs a written contract
- Check what happens if THEY cancel
- Confirm deposit terms and final payment dates
- Understand force majeure clauses

Do you have a specific insurance or contract question?`,quickReplies:["Wedding insurance","Supplier contracts","Public liability","Cancellation terms"]}:e.includes("dietary")||e.includes("vegan")||e.includes("halal")||e.includes("kosher")||e.includes("coeliac")||e.includes("gluten")||e.includes("allerg")?{content:`Managing dietary requirements well is a mark of a thoughtful host.

**How to collect requirements:**
- Ask on your RSVP form (list common options + a free text field)
- Collect 4–6 weeks before the event
- Share a master spreadsheet with your caterer

**What your caterer needs to handle:**
- **Vegetarian/vegan**: A proper dish, not just removal of meat
- **Halal**: Certified halal meat, no cross-contamination
- **Kosher**: Specialist kosher caterer with separate equipment
- **Coeliac**: Dedicated prep area (cross-contamination is a real risk)
- **Nut allergies**: Full allergen awareness, clearly labelled dishes
- **Dairy-free**: Ensure caterer distinguishes from lactose intolerance

**Questions to ask your caterer:**
- Are staff trained in allergen awareness?
- Do you have a dedicated allergen-free prep area?
- Can you provide allergen information for every dish?

**Accessibility too:**
- Step-free access for wheelchair users
- Induction loops for hearing-impaired guests
- Reserved tables near the front for elderly guests

Would you like advice on wording your RSVP form?`,quickReplies:["RSVP form wording","Finding halal caterers","Coeliac-safe menus","Accessibility checklist"]}:e.includes("invit")||e.includes("stationery")||e.includes("save the date")||e.includes("save-the-date")||e.includes("rsvp")?{content:`Invitations set the tone for your event before guests even arrive.

**For weddings — typical suite:**
- Save-the-dates (send 9–12 months before)
- Formal invitations + RSVP cards (send 8–10 weeks before)
- Order of service booklets
- Table plan and place cards

**Typical UK costs:**
- DIY/digital: £0–£300
- Mid-range printed suite (50 invites): £300–£800
- Premium letterpress/foil (50 invites): £600–£2,000

**Digital vs. printed:**
- Online RSVPs save money and are eco-friendly
- Printed invitations feel more premium for weddings
- Many couples do printed invitations + digital save-the-dates

**What to include:**
- Full names, date, time, and location
- Dress code
- RSVP method and deadline
- Dietary requirement section
- Accommodation information
- Gift list (tactfully)

**When to send:**
- Save-the-dates: 9–12 months ahead
- Formal invitations: 8–10 weeks before
- RSVP deadline: 4–6 weeks before

Are you looking for wording advice or supplier recommendations?`,quickReplies:["Invitation wording","Digital invites","Printed stationery","RSVP management"]}:e.includes("speech")||e.includes("speeches")||e.includes("toast")||e.includes("best man")||e.includes("maid of honour")?{content:`Speeches are one of the most memorable parts of a celebration.

**Traditional wedding speech order (UK):**
1. Father of the bride (welcomes groom's family, talks about the bride)
2. Groom or couple (thanks guests, praises partner, thanks families)
3. Best man (humorous anecdotes, toasts the couple)

**Modern variations:**
- Bride and/or both partners speak (increasingly common)
- Maid of honour speaks
- Video messages from guests who can't attend

**Length guidance:**
- Each speech: 3–5 minutes (5 is plenty, 8 is too long)
- Total speeches: under 25 minutes

**Tips for speechmakers:**
- Write it fully, then speak from bullet points
- Practise out loud at least 3 times and time it
- Have water nearby
- Make eye contact with the couple, not just the room
- End with a clear, memorable toast

**Structure:**
1. Attention-grabbing opening
2. 1–2 personal stories/anecdotes
3. Acknowledge families and key guests
4. Heartfelt toast

Would you like help with specific speech content?`,quickReplies:["Father of bride speech","Best man speech","Couple speech","Maid of honour speech"]}:e.includes("dress code")||e.includes("what to wear")||e.includes("black tie")||e.includes("smart casual")||e.includes("lounge suit")?{content:`Dress codes can be confusing — here's a clear guide:

**Black tie**
- Men: black dinner jacket (tuxedo), black bow tie, white dress shirt
- Women: floor-length gown or very formal cocktail dress
- When: evening galas, awards dinners, formal weddings

**Black tie optional / cocktail**
- Men: dark lounge suit is perfectly fine
- Women: cocktail dress (knee to midi), smart jumpsuit

**Lounge suit** (most UK weddings)
- Men: suit and tie (jacket + smart trousers also fine)
- Women: dress, skirt/top, smart trousers or suit

**Smart casual**
- Men: chinos + open-collar shirt or blazer (no jeans unless stated)
- Women: casual dress, smart jeans + nice top, or relaxed midi dress

**Practical tips:**
- Always specify dress code on the invitation
- For outdoor events, suggest appropriate footwear (heels + lawn = disaster!)
- For winter weddings, suggest guests bring a wrap/jacket

Do you need help wording the dress code on your invitations?`,quickReplies:["Wording for invitations","Black tie event tips","Summer garden party","Smart casual guidance"]}:e.includes("honeymoon")||e.includes("holiday")&&t.eventType==="wedding"||e.includes("travel")&&t.eventType==="wedding"?{content:`Honeymoon planning is one of the most enjoyable parts of wedding prep!

**When to book:** 6–12 months ahead for popular destinations.

**Popular UK honeymoon styles:**
- **Long-haul** (Maldives, Bali, Thailand, Mauritius): £4,000–£12,000+
- **European** (Amalfi, Santorini, Tuscany, French Riviera): £2,000–£6,000
- **City break** (Paris, Venice, Prague, Lisbon): £1,500–£4,000
- **UK & Ireland** (Scottish Highlands, Cotswolds, Lake District): £500–£2,500

**Tips:**
- Always tell the hotel it's your honeymoon — often leads to upgrades
- Consider a "minimoon" shortly after the wedding + main trip later
- Use a specialist honeymoon travel agent for better rates
- Check your passport expiry before booking

**Before you travel:**
- Travel insurance (essential)
- Visa requirements if you've changed your name
- Currency and cards
- Any required vaccinations

Where are you thinking of going?`,quickReplies:["Maldives / Bali / Thailand","Italy / Greece","City break","UK staycation"]}:t.eventType?t.budget?t.location?{content:`I can help with many aspects of planning your ${t.eventType||"event"}${t.location?` in ${t.location}`:""}. What would you like to focus on?`,quickReplies:["Venue advice","Budget breakdown","Supplier search","Planning timeline","Legal requirements"]}:{content:`Almost there! Where will your ${t.eventType} be held? Knowing the region lets me give you location-specific venue suggestions and help you find local suppliers.`,quickReplies:["London","South East","North West","Yorkshire","Midlands","Scotland"]}:{content:`To give you the most specific advice for your ${t.eventType}, it really helps to know your budget range. What's your approximate total budget?`,quickReplies:["Under £5k","£5k–£10k","£10k–£20k","£20k–£50k","£50k+"]}:{content:"I'm here to help with every aspect of event planning — venues, budgets, suppliers, timelines, legal requirements, and more. To get started with the most relevant advice, what type of event are you planning?",quickReplies:["Wedding","Birthday Party","Corporate Event","Anniversary","Other"]}}}function v(r,e,t,s,n,a,i,o,u,c){return`
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    :host {
      all: initial;
      display: block;
      font-family: ${t};
      font-size: 14px;
      line-height: 1.5;
      color: #1f2937;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      
      /* CSS Custom Properties for positioning - can be overridden by consumers */
      --jade-offset-bottom: ${s};
      --jade-offset-right: ${n};
      --jade-offset-left: ${a};
      --jade-scale: ${c};
      --jade-primary-color: ${r};
      --jade-accent-color: ${e};
    }

    .jade-widget-container {
      position: fixed;
      bottom: var(--jade-offset-bottom, ${s});
      ${a?`left: var(--jade-offset-left, ${a});`:`right: var(--jade-offset-right, ${n});`}
      ${a?"right: auto;":""}
      z-index: 999999;
      transform: scale(var(--jade-scale, ${c}));
      transform-origin: ${a?"left":"right"} bottom;
    }

    /* Avatar Button */
    .jade-avatar-button {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--jade-primary-color, ${r}) 0%, var(--jade-accent-color, ${e}) 100%);
      border: 3px solid white;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15), 0 4px 8px rgba(0, 0, 0, 0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      animation: float 3s ease-in-out infinite;
      /* Larger tap target using pseudo-element */
      overflow: visible;
    }

    /* Larger invisible tap target for better mobile UX */
    .jade-avatar-button::before {
      content: '';
      position: absolute;
      top: -20px;
      left: -20px;
      right: -20px;
      bottom: -20px;
      border-radius: 50%;
      /* Ensures tap events are captured in the expanded area */
    }

    .jade-avatar-button:hover {
      transform: translateY(-4px) scale(1.05);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2), 0 6px 12px rgba(0, 0, 0, 0.15);
    }

    .jade-avatar-button:active {
      transform: translateY(0) scale(0.98);
    }

    @keyframes float {
      0%, 100% {
        transform: translateY(0px);
      }
      50% {
        transform: translateY(-10px);
      }
    }

    .jade-avatar-icon {
      width: 100%;
      height: 100%;
      color: white;
      font-size: 32px;
      border-radius: 50%;
      object-fit: cover;
    }

    .jade-avatar-fallback {
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, ${r} 0%, ${e} 100%);
    }

    .jade-avatar-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      border-radius: 10px;
      background: #ef4444;
      border: 2px solid white;
      color: white;
      font-size: 11px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1;
      animation: badgePulse 2s ease-in-out infinite;
    }

    @keyframes badgePulse {
      0%, 100% {
        transform: scale(1);
      }
      50% {
        transform: scale(1.1);
      }
    }

    /* Greeting Tooltip */
    .jade-greeting-tooltip {
      position: absolute;
      bottom: 84px;
      ${a?"left: 0;":"right: 0;"}
      background: white;
      padding: 18px 22px;
      border-radius: 16px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.15), 0 4px 12px rgba(0, 0, 0, 0.1);
      max-width: 300px;
      opacity: 0;
      transform: translateY(10px);
      animation: slideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      border: 1px solid rgba(0, 0, 0, 0.05);
    }

    .jade-greeting-tooltip:hover {
      transform: translateY(-4px);
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.2), 0 6px 16px rgba(0, 0, 0, 0.12);
    }

    @keyframes slideUp {
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .jade-greeting-tooltip::after {
      content: '';
      position: absolute;
      bottom: -8px;
      ${a?"left: 24px;":"right: 24px;"}
      width: 16px;
      height: 16px;
      background: white;
      transform: rotate(45deg);
      box-shadow: 4px 4px 8px rgba(0, 0, 0, 0.08);
      border-right: 1px solid rgba(0, 0, 0, 0.05);
      border-bottom: 1px solid rgba(0, 0, 0, 0.05);
    }

    .jade-greeting-text {
      position: relative;
      z-index: 1;
      font-size: 15px;
      color: #374151;
      line-height: 1.6;
      font-weight: 500;
    }

    .jade-greeting-close {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 20px;
      height: 20px;
      border: none;
      background: transparent;
      color: #9ca3af;
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      padding: 0;
      z-index: 2;
    }

    .jade-greeting-close:hover {
      color: #4b5563;
    }

    /* Chat Popup */
    .jade-chat-popup {
      position: absolute;
      bottom: 84px;
      ${a?"left: 0;":"right: 0;"}
      width: 400px;
      height: 600px;
      border-radius: 22px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18), 0 8px 24px rgba(0, 0, 0, 0.12);
      display: flex;
      flex-direction: column;
      opacity: 0;
      transform: translateY(20px) scale(0.95);
      animation: popupOpen 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      border: 1px solid rgba(0, 0, 0, 0.06);
      /* overflow: visible so the settings menu panel is never clipped */
      overflow: visible;
    }

    /* Inner content wrapper — provides overflow clipping for rounded corners */
    .jade-chat-content {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
      border-radius: 22px;
      background: white;
      width: 100%;
      height: 100%;
    }

    @keyframes popupOpen {
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    /* Header */
    .jade-chat-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 24px;
      background: linear-gradient(135deg, ${r} 0%, ${e} 100%);
      color: white;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .jade-chat-header-left {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .jade-chat-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      border: 2px solid rgba(255, 255, 255, 0.3);
    }

    .jade-chat-title {
      font-size: 17px;
      font-weight: 600;
      letter-spacing: -0.02em;
    }

    .jade-chat-status {
      font-size: 13px;
      opacity: 0.95;
      font-weight: 400;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .jade-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      display: inline-block;
      animation: statusPulse 2s ease-in-out infinite;
    }

    @keyframes statusPulse {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: 0.6;
      }
    }

    .jade-chat-controls {
      display: flex;
      gap: 8px;
    }

    .jade-chat-minimize,
    .jade-chat-close {
      width: 32px;
      height: 32px;
      border: none;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      color: white;
      cursor: pointer;
      font-size: 20px;
      line-height: 1;
      transition: background 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .jade-chat-minimize:hover,
    .jade-chat-close:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    /* Menu button */
    .jade-menu-btn {
      width: 32px;
      height: 32px;
      border: none;
      background: rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      color: white;
      cursor: pointer;
      transition: background 0.2s ease, box-shadow 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .jade-menu-btn:hover {
      background: rgba(255, 255, 255, 0.28);
    }

    .jade-menu-btn--open {
      background: rgba(255, 255, 255, 0.3);
      box-shadow: inset 0 0 0 1.5px rgba(255,255,255,0.5);
    }

    .jade-menu-btn:focus-visible {
      outline: 2px solid rgba(255,255,255,0.85);
      outline-offset: 2px;
    }

    /* Settings menu panel */
    .jade-menu-panel {
      position: absolute;
      top: 68px;
      right: 14px;
      background: white;
      border: 1px solid rgba(0,0,0,0.09);
      border-radius: 14px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.14), 0 3px 10px rgba(0,0,0,0.08);
      z-index: 30;
      min-width: 232px;
      padding: 6px 0;
      animation: jade-menu-enter 0.17s cubic-bezier(0.2, 0, 0, 1.2);
    }

    @keyframes jade-menu-enter {
      from { opacity: 0; transform: translateY(-8px) scale(0.96); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    .jade-menu-item {
      display: flex;
      align-items: center;
      gap: 11px;
      width: 100%;
      padding: 11px 16px;
      background: none;
      border: none;
      font-size: 13.5px;
      font-family: inherit;
      color: #1f2937;
      cursor: pointer;
      text-align: left;
      transition: background 0.12s ease;
      line-height: 1.4;
    }

    .jade-menu-item svg {
      flex-shrink: 0;
      opacity: 0.65;
    }

    .jade-menu-item:hover {
      background: #f3f4f6;
    }

    .jade-menu-item:hover svg {
      opacity: 0.9;
    }

    .jade-menu-item:focus-visible {
      outline: none;
      background: #e5e7eb;
    }

    .jade-menu-item--danger {
      color: #dc2626;
    }

    .jade-menu-item--danger svg {
      opacity: 0.75;
    }

    .jade-menu-item--danger:hover {
      background: #fff1f1;
    }

    .jade-menu-item--disabled {
      opacity: 0.4;
      pointer-events: none;
    }

    .jade-menu-divider {
      height: 1px;
      background: rgba(0,0,0,0.07);
      margin: 5px 0;
    }

    /* Sound toggle row */
    .jade-menu-sound-row {
      justify-content: space-between;
      cursor: default;
      user-select: none;
    }

    .jade-menu-sound-row:hover {
      background: none;
    }

    .jade-menu-sound-label {
      display: flex;
      align-items: center;
      gap: 11px;
      color: #1f2937;
      font-size: 13.5px;
    }

    .jade-menu-sound-label svg {
      opacity: 0.65;
    }

    /* Toggle switch */
    .jade-sound-toggle {
      position: relative;
      width: 40px;
      height: 23px;
      background: #d1d5db;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      transition: background 0.22s ease;
      flex-shrink: 0;
      padding: 0;
    }

    .jade-sound-toggle--on {
      background: ${r};
    }

    .jade-sound-toggle-knob {
      position: absolute;
      top: 3.5px;
      left: 3.5px;
      width: 16px;
      height: 16px;
      background: white;
      border-radius: 50%;
      transition: transform 0.22s cubic-bezier(0.34, 1.4, 0.64, 1);
      box-shadow: 0 1px 4px rgba(0,0,0,0.25);
      pointer-events: none;
    }

    .jade-sound-toggle--on .jade-sound-toggle-knob {
      transform: translateX(17px);
    }

    .jade-sound-toggle:focus-visible {
      outline: 2px solid ${r};
      outline-offset: 2px;
    }

    /* Volume row */
    .jade-menu-volume-row {
      gap: 10px;
      flex-wrap: nowrap;
      cursor: default;
      padding-top: 8px;
      padding-bottom: 10px;
    }

    .jade-menu-volume-row:hover {
      background: none;
    }

    .jade-volume-label {
      font-size: 12.5px;
      color: #6b7280;
      white-space: nowrap;
      flex-shrink: 0;
      user-select: none;
    }

    .jade-volume-slider {
      flex: 1;
      -webkit-appearance: none;
      appearance: none;
      height: 5px;
      background: #e5e7eb;
      border-radius: 3px;
      outline: none;
      cursor: pointer;
      min-width: 0;
    }

    .jade-volume-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 15px;
      height: 15px;
      background: ${r};
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 1px 4px rgba(0,0,0,0.25);
      transition: transform 0.12s ease;
    }

    .jade-volume-slider::-webkit-slider-thumb:hover {
      transform: scale(1.15);
    }

    .jade-volume-slider::-moz-range-thumb {
      width: 15px;
      height: 15px;
      background: ${r};
      border-radius: 50%;
      border: none;
      cursor: pointer;
      box-shadow: 0 1px 4px rgba(0,0,0,0.25);
    }

    .jade-volume-slider:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }

    .jade-volume-value {
      font-size: 12px;
      color: #6b7280;
      white-space: nowrap;
      flex-shrink: 0;
      min-width: 30px;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    /* Clear chat confirmation modal */
    .jade-modal-overlay {
      position: absolute;
      inset: 0;
      background: rgba(17, 24, 39, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 50;
      border-radius: 20px;
      animation: jade-overlay-enter 0.18s ease;
    }

    @keyframes jade-overlay-enter {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    .jade-modal {
      background: white;
      border-radius: 16px;
      padding: 22px 20px 18px;
      margin: 20px;
      box-shadow: 0 20px 48px rgba(0,0,0,0.22), 0 4px 12px rgba(0,0,0,0.12);
      max-width: 285px;
      width: 100%;
      animation: jade-modal-enter 0.2s cubic-bezier(0.34, 1.3, 0.64, 1);
    }

    @keyframes jade-modal-enter {
      from { opacity: 0; transform: scale(0.92) translateY(8px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }

    .jade-modal-title {
      font-size: 15.5px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 8px;
    }

    .jade-modal-desc {
      font-size: 13px;
      color: #6b7280;
      line-height: 1.55;
      margin-bottom: 20px;
    }

    .jade-modal-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    .jade-modal-btn {
      padding: 8px 18px;
      border-radius: 9px;
      border: none;
      font-size: 13.5px;
      font-family: inherit;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.15s ease;
    }

    .jade-modal-btn--cancel {
      background: #f3f4f6;
      color: #374151;
    }

    .jade-modal-btn--cancel:hover {
      background: #e5e7eb;
    }

    .jade-modal-btn--confirm {
      background: #dc2626;
      color: white;
      box-shadow: 0 2px 6px rgba(220,38,38,0.35);
    }

    .jade-modal-btn--confirm:hover {
      background: #b91c1c;
      box-shadow: 0 3px 8px rgba(185,28,28,0.4);
    }

    .jade-modal-btn:focus-visible {
      outline: 2px solid ${r};
      outline-offset: 2px;
    }

    /* Export success toast */
    .jade-toast {
      position: absolute;
      bottom: 76px;
      left: 50%;
      transform: translateX(-50%);
      background: #111827;
      color: white;
      font-size: 13px;
      font-weight: 500;
      padding: 9px 16px;
      border-radius: 24px;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.2);
      z-index: 40;
      white-space: nowrap;
      animation: jade-toast-enter 0.25s cubic-bezier(0.34, 1.3, 0.64, 1);
      pointer-events: none;
    }

    @keyframes jade-toast-enter {
      from { opacity: 0; transform: translateX(-50%) translateY(10px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }


    .jade-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      background: #f8f9fb;
    }

    .jade-chat-messages::-webkit-scrollbar {
      width: 6px;
    }

    .jade-chat-messages::-webkit-scrollbar-track {
      background: transparent;
    }

    .jade-chat-messages::-webkit-scrollbar-thumb {
      background: #d1d5db;
      border-radius: 3px;
    }

    .jade-message {
      display: flex;
      gap: 8px;
      animation: messageSlide 0.3s ease;
    }

    @keyframes messageSlide {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .jade-message-user {
      flex-direction: row-reverse;
    }

    .jade-message-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
    }

    .jade-message-avatar.assistant {
      background: linear-gradient(135deg, ${r} 0%, ${e} 100%);
      color: white;
      overflow: hidden;
    }

    .jade-msg-avatar-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 50%;
    }

    .jade-message-avatar.user {
      background: #e5e7eb;
      color: #6b7280;
    }

    .jade-message-content {
      max-width: 70%;
    }

    .jade-message-bubble {
      padding: 10px 16px;
      border-radius: 18px;
      word-wrap: break-word;
      word-break: break-word;
      overflow-wrap: break-word;
      line-height: 1.55;
      font-size: 14px;
    }

    .jade-message-assistant .jade-message-bubble {
      background: white;
      color: #1f2937;
      border-bottom-left-radius: 4px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04);
    }

    .jade-message-user .jade-message-bubble {
      background: linear-gradient(135deg, ${r} 0%, ${e} 100%);
      color: white;
      border-bottom-right-radius: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }

    .jade-message-time {
      font-size: 11px;
      color: #9ca3af;
      margin-top: 5px;
      padding: 0 4px;
    }

    /* Markdown rendering styles */
    .jade-md-list {
      margin: .35em 0 .35em 1.25em;
      padding: 0;
      line-height: 1.65;
    }

    .jade-md-list li {
      margin-bottom: .2em;
    }

    .jade-inline-code {
      background: rgba(0,0,0,.07);
      padding: 2px 5px;
      border-radius: 4px;
      font-size: .88em;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      letter-spacing: -.01em;
    }

    /* Quick Replies */
    .jade-quick-replies {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }

    .jade-quick-reply-btn {
      padding: 7px 14px;
      border: 1.5px solid ${r};
      background: white;
      color: ${r};
      border-radius: 20px;
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      white-space: nowrap;
      letter-spacing: 0.01em;
    }

    .jade-quick-reply-btn:hover {
      background: ${r};
      color: white;
      transform: translateY(-1px);
      box-shadow: 0 3px 8px rgba(0,0,0,0.15);
    }

    .jade-quick-reply-btn:active {
      transform: translateY(0);
    }

    /* Input Area */
    .jade-chat-input-area {
      padding: 14px 18px 16px;
      background: white;
      border-top: 1px solid rgba(0,0,0,0.06);
      border-radius: 0 0 20px 20px;
    }

    .jade-chat-input-wrapper {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }

    .jade-chat-input {
      flex: 1;
      padding: 10px 16px;
      border: 1.5px solid #e5e7eb;
      border-radius: 22px;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      resize: none;
      max-height: 100px;
      min-height: 40px;
      background: #f9fafb;
      transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
      color: #1f2937;
      line-height: 1.5;
    }

    .jade-chat-input:focus {
      border-color: ${r};
      background: white;
      box-shadow: 0 0 0 3px rgba(0, 178, 169, 0.12);
    }

    .jade-chat-input::placeholder {
      color: #9ca3af;
    }

    .jade-char-count {
      font-size: 11px;
      color: #9ca3af;
      text-align: right;
      margin-top: 4px;
      height: 16px;
      opacity: 0;
      transition: opacity 0.2s ease;
    }

    .jade-char-count-visible {
      opacity: 1;
    }

    .jade-chat-send-btn {
      width: 40px;
      height: 40px;
      border: none;
      background: linear-gradient(135deg, ${r} 0%, ${e} 100%);
      color: white;
      border-radius: 50%;
      cursor: pointer;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }

    .jade-chat-send-btn:hover:not(:disabled) {
      transform: scale(1.08);
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    }

    .jade-chat-send-btn:active:not(:disabled) {
      transform: scale(0.96);
    }

    .jade-chat-send-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      box-shadow: none;
    }

    /* Loading indicator */
    .jade-typing-indicator {
      display: flex;
      gap: 4px;
      padding: 10px 14px;
    }

    .jade-typing-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #9ca3af;
      animation: typing 1.4s infinite;
    }

    .jade-typing-dot:nth-child(2) {
      animation-delay: 0.2s;
    }

    .jade-typing-dot:nth-child(3) {
      animation-delay: 0.4s;
    }

    @keyframes typing {
      0%, 60%, 100% {
        transform: translateY(0);
        opacity: 0.7;
      }
      30% {
        transform: translateY(-10px);
        opacity: 1;
      }
    }

    /* Responsive */
    @media (max-width: 480px) {
      :host {
        /* Mobile-specific CSS custom properties */
        --jade-offset-bottom: ${i||s};
        --jade-offset-right: ${o||(n==="24px"?"16px":n)};
        --jade-offset-left: ${u||(a&&a==="24px"?"16px":a)};
      }
      
      .jade-widget-container {
        bottom: var(--jade-offset-bottom);
        ${a?"left: var(--jade-offset-left);":"right: var(--jade-offset-right);"}
        ${a?"right: auto;":""}
      }

      .jade-chat-popup {
        width: calc(100vw - 32px);
        /* Fallback for browsers without dvh or min() support */
        max-height: 600px;
        /* Fallback for browsers without dvh support */
        height: min(600px, calc(100vh - 120px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)));
        /* Modern browsers with dvh support - prevents cut-off on mobile */
        height: min(600px, calc(100dvh - 120px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)));
      }

      .jade-chat-content {
        border-radius: 22px;
      }

      .jade-greeting-tooltip {
        max-width: calc(100vw - 120px);
      }
    }

    /* Hidden utility */
    .jade-hidden {
      display: none !important;
    }
  `}class y{constructor(e={}){this.isMenuOpen=!1,this.showClearConfirm=!1,this.showExportToast=!1,this.config={...p,...e},this.apiClient=new b(this.config.apiBaseUrl,this.config.authToken),this.config.debug&&(console.log("[JadeWidget] Initializing with config:",this.config),console.log("[JadeWidget] Avatar URL:",this.config.avatarUrl));try{localStorage.setItem("__jade_test__","1"),localStorage.removeItem("__jade_test__")}catch{console.warn("[JadeWidget] localStorage is unavailable – chat history, sound settings and session state will not be persisted across page loads.")}this.escapeKeyHandler=a=>{a.key==="Escape"&&(this.showClearConfirm?(this.showClearConfirm=!1,this.render()):this.isMenuOpen?(this.isMenuOpen=!1,this.render()):this.state.isOpen&&this.closeChat())},this.soundEnabled=d.loadSoundEnabled(),this.soundVolume=d.loadSoundVolume();const t=d.loadState(),s=d.loadMessages(),n=d.loadConversationId();this.state={isOpen:t.isOpen||!1,isMinimized:t.isMinimized||!1,showGreeting:!1,conversationId:n||void 0,messages:s.length>0?s:this.getInitialMessages()},this.container=document.createElement("div"),this.container.className="jade-widget-root",this.shadowRoot=this.container.attachShadow({mode:"open"}),this.render(),this.attachEventListeners()}getInitialMessages(){return[{id:"initial",role:"assistant",content:this.config.greetingText,timestamp:Date.now(),quickReplies:["Yes, please","No, thanks"]}]}render(){const e=v(this.config.primaryColor,this.config.accentColor,this.config.fontFamily,this.config.offsetBottom,this.config.offsetRight,this.config.offsetLeft,this.config.offsetBottomMobile,this.config.offsetRightMobile,this.config.offsetLeftMobile,this.config.scale);this.shadowRoot.innerHTML=`
      <style>${e}</style>
      <div class="jade-widget-container">
        ${this.renderAvatar()}
        ${this.state.showGreeting&&!this.state.isOpen?this.renderGreeting():""}
        ${this.state.isOpen?this.renderChatPopup():""}
      </div>
    `}renderAvatar(){const e=this.config.avatarUrl?`<img src="${this.escapeHtml(this.config.avatarUrl)}" alt="Chat Assistant" class="jade-avatar-icon jade-avatar-img" />
         <span class="jade-avatar-icon jade-avatar-fallback" style="display:none;">💬</span>`:'<span class="jade-avatar-icon">💬</span>',t=this.state.showGreeting&&!this.state.isOpen?'<span class="jade-avatar-badge" aria-label="1 new notification">1</span>':"";return`
      <button class="jade-avatar-button" aria-label="Toggle chat" data-action="toggle-chat">
        ${e}
        ${t}
      </button>
    `}renderGreeting(){return this.config.greetingTooltipText?`
      <div class="jade-greeting-tooltip" data-action="open-chat" role="tooltip" aria-live="polite">
        <button class="jade-greeting-close" aria-label="Dismiss greeting" data-action="close-greeting">×</button>
        <div class="jade-greeting-text">${this.escapeHtml(this.config.greetingTooltipText)}</div>
      </div>
    `:""}renderChatPopup(){return`
      <div class="jade-chat-popup" role="dialog" aria-label="Chat">
        <div class="jade-chat-content">
          ${this.renderHeader()}
          ${this.renderMessages()}
          ${this.renderInputArea()}
          ${this.showClearConfirm?this.renderClearConfirmModal():""}
          ${this.showExportToast?this.renderExportToast():""}
        </div>
        ${this.isMenuOpen?this.renderMenu():""}
      </div>
    `}renderHeader(){const e=`jade-menu-btn${this.isMenuOpen?" jade-menu-btn--open":""}`;return`
      <div class="jade-chat-header">
        <div class="jade-chat-header-left">
          <div class="jade-chat-avatar">
            ${this.config.avatarUrl?`<img src="${this.escapeHtml(this.config.avatarUrl)}" alt="${this.escapeHtml(this.config.assistantName)}" class="jade-header-avatar-img" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`:"💬"}
          </div>
          <div>
            <div class="jade-chat-title">${this.escapeHtml(this.config.assistantName)}</div>
            <div class="jade-chat-status"><span class="jade-status-dot"></span>Online</div>
          </div>
        </div>
        <div class="jade-chat-controls">
          <button class="${e}" aria-label="${this.isMenuOpen?"Close menu":"Open menu"}" aria-haspopup="true" aria-expanded="${this.isMenuOpen}" data-action="toggle-menu" title="Menu">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <circle cx="8" cy="3" r="1.5" fill="currentColor"/>
              <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
              <circle cx="8" cy="13" r="1.5" fill="currentColor"/>
            </svg>
          </button>
          <button class="jade-chat-minimize" aria-label="Minimize chat" data-action="minimize-chat" title="Minimize">−</button>
          <button class="jade-chat-close" aria-label="Close chat" data-action="close-chat" title="Close">×</button>
        </div>
      </div>
    `}renderMenu(){const e=Math.round(this.soundVolume*100);return`
      <div class="jade-menu-panel" role="menu" aria-label="Chat options">
        <button class="jade-menu-item" data-action="export-chat" role="menuitem">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M7.5 1v9M4 7l3.5 3.5L11 7M2 12h11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Export chat
        </button>
        <div class="jade-menu-divider" role="separator"></div>
        <div class="jade-menu-item jade-menu-sound-row">
          <span class="jade-menu-sound-label">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M3 5.5H1.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5H3l3 3V2.5L3 5.5z" fill="currentColor"/>
              <path d="M9.5 5.5c.83.83.83 2.17 0 3M11.5 3.5c1.66 1.66 1.66 4.34 0 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
            Sounds
          </span>
          <button
            class="jade-sound-toggle ${this.soundEnabled?"jade-sound-toggle--on":""}"
            data-action="toggle-sound"
            aria-label="${this.soundEnabled?"Disable sounds":"Enable sounds"}"
            aria-pressed="${this.soundEnabled}"
            title="${this.soundEnabled?"Sounds on":"Sounds off"}"
          >
            <span class="jade-sound-toggle-knob"></span>
          </button>
        </div>
        <div class="jade-menu-item jade-menu-volume-row ${this.soundEnabled?"":"jade-menu-item--disabled"}">
          <label class="jade-volume-label" for="jade-volume-slider">Volume</label>
          <input
            type="range"
            id="jade-volume-slider"
            class="jade-volume-slider"
            min="0"
            max="100"
            value="${e}"
            aria-label="Notification volume"
            data-action="volume-change"
            ${this.soundEnabled?"":"disabled"}
          />
          <span class="jade-volume-value">${e}%</span>
        </div>
        <div class="jade-menu-divider" role="separator"></div>
        <button class="jade-menu-item jade-menu-item--danger" data-action="show-clear-confirm" role="menuitem">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M3 3.5h9M5.5 3.5V2h4v1.5M6 6v5M9 6v5M3.5 3.5l.75 9h7.5l.75-9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Clear chat
        </button>
      </div>
    `}renderClearConfirmModal(){return`
      <div class="jade-modal-overlay" data-action="cancel-clear-chat" role="presentation">
        <div class="jade-modal" data-action="modal-stop" role="alertdialog" aria-modal="true" aria-labelledby="jade-modal-title" aria-describedby="jade-modal-desc">
          <p class="jade-modal-title" id="jade-modal-title">Clear conversation?</p>
          <p class="jade-modal-desc" id="jade-modal-desc">This will delete all messages and reset the chat. This action cannot be undone.</p>
          <div class="jade-modal-actions">
            <button class="jade-modal-btn jade-modal-btn--cancel" data-action="cancel-clear-chat">Cancel</button>
            <button class="jade-modal-btn jade-modal-btn--confirm" data-action="confirm-clear-chat">Clear chat</button>
          </div>
        </div>
      </div>
    `}renderExportToast(){return`
      <div class="jade-toast" role="status" aria-live="polite">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M2 7.5l3 3 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Chat exported successfully
      </div>
    `}renderMessages(){return`
      <div class="jade-chat-messages" data-messages-container>
        ${this.state.messages.map(t=>this.renderMessage(t)).join("")}
      </div>
    `}renderMessage(e){const t=e.role==="user",s=new Date(e.timestamp).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),n=!t&&e.quickReplies?`
      <div class="jade-quick-replies">
        ${e.quickReplies.map(o=>`<button class="jade-quick-reply-btn" data-action="quick-reply" data-reply="${this.escapeHtml(o)}">${this.escapeHtml(o)}</button>`).join("")}
      </div>
    `:"",a=t?this.escapeHtml(e.content):this.renderMarkdown(e.content),i=t?"👤":this.config.avatarUrl?`<img src="${this.escapeHtml(this.config.avatarUrl)}" alt="${this.escapeHtml(this.config.assistantName)}" class="jade-msg-avatar-img" />`:"💬";return`
      <div class="jade-message jade-message-${e.role}" data-message-id="${e.id}">
        <div class="jade-message-avatar ${e.role}">
          ${i}
        </div>
        <div class="jade-message-content">
          <div class="jade-message-bubble">${a}</div>
          <div class="jade-message-time">${s}</div>
          ${n}
        </div>
      </div>
    `}renderMarkdown(e){const n=this.escapeHtml(e).replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/\*([^*\n]+?)\*/g,(u,c)=>`<em>${c}</em>`).replace(/`([^`\n]+?)`/g,'<code class="jade-inline-code">$1</code>').split(`
`),a=[];let i=!1,o=null;for(let u=0;u<n.length;u++){const c=n[u],m=/^[-*•]\s+(.*)/.exec(c),f=/^\d+\.\s+(.*)/.exec(c);m?((!i||o!=="ul")&&(i&&a.push(o==="ol"?"</ol>":"</ul>"),a.push('<ul class="jade-md-list">'),i=!0,o="ul"),a.push(`<li>${m[1]}</li>`)):f?((!i||o!=="ol")&&(i&&a.push(o==="ul"?"</ul>":"</ol>"),a.push('<ol class="jade-md-list">'),i=!0,o="ol"),a.push(`<li>${f[1]}</li>`)):(i&&(a.push(o==="ol"?"</ol>":"</ul>"),i=!1,o=null),c.trim()===""?a.push("<br>"):a.push(c))}return i&&a.push(o==="ol"?"</ol>":"</ul>"),a.join(`
`)}renderInputArea(){return`
      <div class="jade-chat-input-area">
        <div class="jade-chat-input-wrapper">
          <textarea 
            class="jade-chat-input" 
            placeholder="Type your message..."
            rows="1"
            aria-label="Message input"
            maxlength="1000"
            data-input
          ></textarea>
          <button class="jade-chat-send-btn" aria-label="Send message" data-action="send" title="Send">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 1L7 9M15 1L10 15L7 9M15 1L1 6L7 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
        <div class="jade-char-count" aria-live="polite" aria-atomic="true"></div>
      </div>
    `}attachEventListeners(){this.shadowRoot.addEventListener("click",s=>{const a=s.target.closest("[data-action]"),i=a==null?void 0:a.getAttribute("data-action");if(this.config.debug&&i&&console.log("[JadeWidget] Menu action dispatched:",i),i==="toggle-chat")this.toggleChat();else if(i==="open-chat")this.openChat();else if(i==="close-chat")this.closeChat();else if(i==="minimize-chat")this.minimizeChat();else if(i==="close-greeting")s.stopPropagation(),this.closeGreeting();else if(i==="send")this.handleSend();else if(i==="quick-reply"){const o=a==null?void 0:a.getAttribute("data-reply");o&&this.handleQuickReply(o)}else if(i==="toggle-menu")s.stopPropagation(),this.isMenuOpen=!this.isMenuOpen,this.render(),this.isMenuOpen&&setTimeout(()=>{const o=this.shadowRoot.querySelector('.jade-menu-panel [role="menuitem"]');o==null||o.focus()},50);else if(i==="export-chat")this.isMenuOpen=!1,this.render(),this.exportChat();else if(i==="toggle-sound")s.stopPropagation(),this.soundEnabled=!this.soundEnabled,d.saveSoundEnabled(this.soundEnabled),this.soundEnabled&&this.unlockAudioContext(),this.render();else if(i==="show-clear-confirm")this.isMenuOpen=!1,this.showClearConfirm=!0,this.render(),setTimeout(()=>{const o=this.shadowRoot.querySelector(".jade-modal-btn--cancel");o==null||o.focus()},50);else if(i==="cancel-clear-chat")this.showClearConfirm=!1,this.render();else if(i==="confirm-clear-chat")this.showClearConfirm=!1,this.performClearChat();else if(i==="modal-stop"){s.stopPropagation();return}this.isMenuOpen&&i!=="toggle-menu"&&!(a!=null&&a.closest(".jade-menu-panel"))&&(this.isMenuOpen=!1,this.render())}),this.shadowRoot.addEventListener("keydown",s=>{const n=s,a=s.target;a.hasAttribute("data-input")&&n.key==="Enter"&&!n.shiftKey&&(s.preventDefault(),this.handleSend()),a.classList.contains("jade-menu-btn")&&(n.key==="Enter"||n.key===" ")&&(s.preventDefault(),this.isMenuOpen=!this.isMenuOpen,this.render(),this.isMenuOpen&&setTimeout(()=>{const i=this.shadowRoot.querySelector('.jade-menu-panel [role="menuitem"]');i==null||i.focus()},50))}),this.shadowRoot.addEventListener("input",s=>{const n=s.target;if(n.hasAttribute("data-input")){const a=n;a.style.height="auto",a.style.height=Math.min(a.scrollHeight,100)+"px";const i=this.shadowRoot.querySelector(".jade-char-count");if(i){const o=a.value.length;o>1e3*.8?(i.textContent=`${o}/1000`,i.classList.add("jade-char-count-visible")):(i.textContent="",i.classList.remove("jade-char-count-visible"))}}else if(n.getAttribute("data-action")==="volume-change"){const i=parseInt(n.value,10)/100;this.soundVolume=i,d.saveSoundVolume(i);const o=this.shadowRoot.querySelector(".jade-volume-value");o&&(o.textContent=`${Math.round(i*100)}%`)}}),document.addEventListener("keydown",this.escapeKeyHandler);const e=this.shadowRoot.querySelector(".jade-avatar-img");e&&(e.addEventListener("error",()=>{this.config.debug&&console.error("[JadeWidget] Failed to load avatar image:",this.config.avatarUrl),e.setAttribute("style","display:none;");const s=this.shadowRoot.querySelector(".jade-avatar-fallback");s&&s.setAttribute("style","display:flex;")}),e.addEventListener("load",()=>{this.config.debug&&console.log("[JadeWidget] Avatar image loaded successfully:",this.config.avatarUrl)}));const t=this.shadowRoot.querySelector(".jade-header-avatar-img");t&&(t.addEventListener("error",()=>{this.config.debug&&console.error("[JadeWidget] Failed to load header avatar image:",this.config.avatarUrl);const s=t.parentElement;s&&(s.innerHTML="💬")}),t.addEventListener("load",()=>{this.config.debug&&console.log("[JadeWidget] Header avatar image loaded successfully:",this.config.avatarUrl)}))}toggleChat(){this.state.isOpen?this.closeChat():this.openChat()}openChat(){this.state.isOpen=!0,this.state.showGreeting=!1,this.greetingTimeout&&clearTimeout(this.greetingTimeout),d.setGreetingDismissed(),d.saveState({isOpen:!0,showGreeting:!1}),this.render(),this.scrollToBottom(),this.focusInput()}closeChat(){this.state.isOpen=!1,this.isMenuOpen=!1,this.showClearConfirm=!1,d.saveState({isOpen:!1}),this.render()}minimizeChat(){this.state.isMinimized=!0,this.state.isOpen=!1,this.isMenuOpen=!1,this.showClearConfirm=!1,d.saveState({isOpen:!1,isMinimized:!0}),this.render()}closeGreeting(){this.state.showGreeting=!1,d.setGreetingDismissed(),this.render()}async handleSend(){const e=this.shadowRoot.querySelector("[data-input]");if(!e)return;const t=e.value.trim();if(!t)return;const s={id:"user-"+Date.now(),role:"user",content:t,timestamp:Date.now()};this.state.messages.push(s),d.saveMessages(this.state.messages),e.value="",e.style.height="auto",this.render(),this.scrollToBottom(),this.soundEnabled&&this.unlockAudioContext(),this.showTypingIndicator();try{const n=await this.apiClient.sendMessage(t,this.state.conversationId);this.state.conversationId||(this.state.conversationId=n.conversationId,d.saveConversationId(n.conversationId)),this.state.messages.push(n.message),d.saveMessages(this.state.messages),this.playNotificationSound(),this.removeTypingIndicator(),this.render(),this.scrollToBottom(),this.focusInput()}catch(n){console.error("Failed to send message:",n),this.removeTypingIndicator();const a=n instanceof Error?n.message:"";let i;a.includes("429")||a.toLowerCase().includes("rate limit")?i="I'm getting a lot of requests right now — please wait a moment and try again. ⏳":a.includes("401")||a.includes("403")?i="I couldn't authenticate your request. Please refresh the page and try again.":a.includes("503")||a.includes("Failed to fetch")?i="I'm having trouble connecting right now. Please check your connection and try again.":i="I'm sorry, something went wrong. Please try again.";const o={id:"error-"+Date.now(),role:"assistant",content:i,timestamp:Date.now()};this.state.messages.push(o),d.saveMessages(this.state.messages),this.render(),this.scrollToBottom()}}handleQuickReply(e){const t=this.shadowRoot.querySelector("[data-input]");t&&(t.value=e,this.handleSend())}showTypingIndicator(){this.removeTypingIndicator();const e=this.shadowRoot.querySelector("[data-messages-container]");if(e){const t=document.createElement("div");t.className="jade-message jade-message-assistant",t.setAttribute("data-typing-indicator",""),t.innerHTML=`
        <div class="jade-message-avatar assistant">💬</div>
        <div class="jade-message-content">
          <div class="jade-message-bubble">
            <div class="jade-typing-indicator">
              <div class="jade-typing-dot"></div>
              <div class="jade-typing-dot"></div>
              <div class="jade-typing-dot"></div>
            </div>
          </div>
        </div>
      `,e.appendChild(t),this.scrollToBottom()}}removeTypingIndicator(){const e=this.shadowRoot.querySelector("[data-typing-indicator]");e&&e.remove()}unlockAudioContext(){try{this.audioCtx||(this.audioCtx=new(window.AudioContext||window.webkitAudioContext)),this.audioCtx.state==="suspended"&&this.audioCtx.resume().catch(()=>{})}catch{}}playNotificationSound(){if(this.soundEnabled){this.config.debug&&console.log("[JadeWidget] Playing notification sound (volume:",this.soundVolume,")");try{this.audioCtx||(this.audioCtx=new(window.AudioContext||window.webkitAudioContext));const e=this.audioCtx,t=()=>{const s=e.createGain();s.gain.setValueAtTime(0,e.currentTime),s.gain.linearRampToValueAtTime(this.soundVolume*.3,e.currentTime+.02),s.gain.exponentialRampToValueAtTime(1e-4,e.currentTime+.5),s.connect(e.destination),[880,1108].forEach((a,i)=>{const o=e.createOscillator();o.type="sine",o.frequency.setValueAtTime(a,e.currentTime+i*.12),o.connect(s),o.start(e.currentTime+i*.12),o.stop(e.currentTime+i*.12+.35)})};e.state==="suspended"?(this.config.debug&&console.warn("[JadeWidget] AudioContext suspended – attempting resume before chime"),e.resume().then(t).catch(()=>{console.info("[JadeWidget] Notification sound skipped – AudioContext could not be resumed (likely no prior user gesture)")})):t()}catch{}}}exportChat(){const e={exportedAt:new Date().toISOString(),messages:this.state.messages.map(i=>({role:i.role,content:i.content,timestamp:new Date(i.timestamp).toISOString()}))},t=JSON.stringify(e,null,2),s=new Blob([t],{type:"application/json"}),n=URL.createObjectURL(s),a=document.createElement("a");a.href=n,a.download=`jade-chat-${new Date().toISOString().slice(0,10)}.json`,document.body.appendChild(a),a.click(),document.body.removeChild(a),setTimeout(()=>URL.revokeObjectURL(n),500),this.exportToastTimeout&&clearTimeout(this.exportToastTimeout),this.showExportToast=!0,this.render(),this.exportToastTimeout=window.setTimeout(()=>{this.showExportToast=!1,this.render()},3e3)}performClearChat(){d.clearAll(),this.isMenuOpen=!1,this.showClearConfirm=!1,this.state={isOpen:!1,isMinimized:!1,showGreeting:!1,messages:this.getInitialMessages()},this.render()}scrollToBottom(){setTimeout(()=>{const e=this.shadowRoot.querySelector("[data-messages-container]");e&&(e.scrollTop=e.scrollHeight)},100)}focusInput(){setTimeout(()=>{const e=this.shadowRoot.querySelector("[data-input]");e&&e.focus()},100)}escapeHtml(e){const t=document.createElement("div");return t.textContent=e,t.innerHTML}shouldShowGreeting(){const e=d.loadMessages(),t=e.length===0||e.length===1;return!this.state.isOpen&&t&&!d.isGreetingDismissed()}mount(e){(e||document.body).appendChild(this.container),this.shouldShowGreeting()&&(this.greetingTimeout=window.setTimeout(()=>{this.state.showGreeting=!0,this.render()},1e3))}unmount(){this.container.remove(),this.greetingTimeout&&clearTimeout(this.greetingTimeout),this.exportToastTimeout&&clearTimeout(this.exportToastTimeout),this.audioCtx&&(this.audioCtx.close().catch(()=>{}),this.audioCtx=void 0),document.removeEventListener("keydown",this.escapeKeyHandler)}open(){this.openChat()}close(){this.closeChat()}toggle(){this.toggleChat()}reset(){d.clearAll(),this.state={isOpen:!1,isMinimized:!1,showGreeting:!1,messages:this.getInitialMessages()},this.render()}}function x(r){var t;(t=window.JadeWidget)!=null&&t.instance&&window.JadeWidget.instance.unmount();const e=(r==null?void 0:r.showDelayMs)??p.showDelayMs;setTimeout(()=>{const s=new y(r);s.mount(),window.JadeWidget&&(window.JadeWidget.instance=s)},e)}const g={init:x};typeof window<"u"&&(window.JadeWidget=g),h.default=g,Object.defineProperties(h,{__esModule:{value:!0},[Symbol.toStringTag]:{value:"Module"}})})(this.JadeWidget=this.JadeWidget||{});
