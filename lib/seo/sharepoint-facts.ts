/**
 * Facts shared by the SharePoint and InfoPath pages, /llms.txt and the docs:
 * Microsoft's dates (each with the Microsoft page it comes from), the
 * UserTasks SharePoint extension's price, versions and deployment options,
 * and a neutral comparison of the options people weigh.
 *
 * Rules: every Microsoft date links to a Microsoft page; statements about
 * Nintex and Power Automate are facts their vendors publish, without
 * judgement; no ratings, customer counts or invented numbers.
 */

export type Source = { label: string; href: string }

/** When the dates and vendor facts below were last checked against their sources. */
export const SHAREPOINT_FACTS_CHECKED = '2026-11-15'

export const MS = {
  kb5002945: { label: 'Microsoft Support: Security update for SharePoint Server Subscription Edition, November 10, 2026 (KB5002945)', href: 'https://support.microsoft.com/en-us/servicing/office/hotfix/sharepoint/5002945' },
  seDeprecated: { label: "Microsoft Learn: What's deprecated or removed from SharePoint Server Subscription Edition", href: 'https://learn.microsoft.com/en-us/sharepoint/what-s-new/what-s-deprecated-or-removed-from-sharepoint-server-subscription-edition' },
  sp2010Retirement: { label: 'Microsoft Support: SharePoint 2010 workflow retirement', href: 'https://support.microsoft.com/en-us/office/sharepoint-2010-workflow-retirement-1ca3fff8-9985-410a-85aa-8120f626965f' },
  sp2013Retirement: { label: 'Microsoft Support: SharePoint 2013 workflow retirement', href: 'https://support.microsoft.com/en-us/office/sharepoint-2013-workflow-retirement-4613d9cf-69aa-40f7-b6bf-6e7831c9691e' },
  spd2013: { label: 'Microsoft Lifecycle: SharePoint Designer 2013', href: 'https://learn.microsoft.com/en-us/lifecycle/products/sharepoint-designer-2013' },
  infopath2013: { label: 'Microsoft Lifecycle: InfoPath 2013', href: 'https://learn.microsoft.com/en-us/lifecycle/products/infopath-2013' },
  infopathBlog: { label: 'Microsoft Tech Community: Support update for InfoPath Forms Services in Microsoft 365', href: 'https://techcommunity.microsoft.com/blog/spblog/support-update-for-infopath-forms-services-in-microsoft-365/3858190' },
  sp2016: { label: 'Microsoft Lifecycle: SharePoint Server 2016', href: 'https://learn.microsoft.com/en-us/lifecycle/products/sharepoint-server-2016' },
  sp2019: { label: 'Microsoft Lifecycle: SharePoint Server 2019', href: 'https://learn.microsoft.com/en-us/lifecycle/products/sharepoint-server-2019' },
  spse: { label: 'Microsoft Lifecycle: SharePoint Server Subscription Edition', href: 'https://learn.microsoft.com/en-us/lifecycle/products/sharepoint-server-subscription-edition' },
  powerAutomateMigration: { label: 'Microsoft Learn: Migrate from classic workflows to Power Automate flows in SharePoint', href: 'https://learn.microsoft.com/en-us/sharepoint/dev/business-apps/power-automate/guidance/migrate-from-classic-workflows-to-power-automate-flows' },
  sharePointConnector: { label: 'Microsoft Learn: SharePoint connector (Power Platform)', href: 'https://learn.microsoft.com/en-us/connectors/sharepointonline/' },
} satisfies Record<string, Source>

export const NINTEX_SE_DOCS: Source = { label: 'Nintex: Install, upgrade, and migrate Nintex for SharePoint Subscription Edition', href: 'https://help.nintex.com/en-US/nintexSE/current/sp2019/InstallUpgradeMigrate.htm' }
export const NINTEX_2010_ENGINE: Source = { label: 'Nintex: Attention SharePoint Subscription Edition customers, action required before the September 2026 CU (August 2026)', href: 'https://community.nintex.com/news-18/attention-sharepoint-subscription-edition-customers-action-required-before-the-september-2026-cu-74209' }

/** Microsoft's own words in KB5002945, quoted on the pages. */
export const KB5002945_QUOTE = 'The July 13, 2027, public update removes Microsoft SharePoint 2010 workflows and InfoPath Forms Services from SharePoint Server Subscription Edition.'

export const SHAREPOINT_PRICE = { amount: '$7,500', value: '7500', currency: 'USD', unit: 'per SharePoint farm, per year', includes: 'updates and support' }

/** Self-serve trials (usertasks.com/sharepoint/trial; Settings → Extensions inside the product). */
export const SHAREPOINT_TRIAL = {
  days: 30,
  path: '/sharepoint/trial',
  title: 'Start a 30-day free trial of UserTasks for SharePoint Server',
  metaTitle: 'SharePoint workflow and forms free trial (30 days) | UserTasks',
  description: 'Try the UserTasks SharePoint extension free for 30 days on your own SharePoint Server farm: enter your work email and farm ID, get a signed trial licence at once, and install it in self-hosted UserTasks. No card. One trial per farm and per company.',
}

/** The step-by-step page: trial → install → connect SharePoint → first list. */
export const SHAREPOINT_GET_STARTED = {
  path: '/sharepoint/get-started',
  title: 'Get started with UserTasks for SharePoint Server: trial, install, connect, first workflow',
  metaTitle: 'Get started with the SharePoint extension in 4 steps | UserTasks',
  description: 'Start the free 30-day trial with your farm ID, install self-hosted UserTasks with one command (Windows or Linux), connect SharePoint and install the add-in, then put UserTasks forms and workflows on a list. About an hour.',
}

export const SUPPORTED_VERSIONS = 'SharePoint Server 2016, SharePoint Server 2019 and SharePoint Server Subscription Edition'

/**
 * Short, quotable facts (a definition list on the pages, bullets in
 * /llms.txt). Each value is one sentence that stands on its own.
 */
export const SHAREPOINT_KEY_FACTS: Array<{ label: string; value: string; source?: Source }> = [
  { label: 'What it is', value: 'UserTasks for SharePoint is a paid extension of UserTasks, the open-source (Apache-2.0) workflow and forms platform, that replaces SharePoint 2010 and 2013 workflows and InfoPath forms inside SharePoint Server lists and libraries.' },
  { label: 'Why now', value: 'Microsoft says the July 13, 2027 public update removes SharePoint 2010 workflows and InfoPath Forms Services from SharePoint Server Subscription Edition; both reached end of support on July 14, 2026.', source: MS.kb5002945 },
  { label: 'Supported versions', value: `${SUPPORTED_VERSIONS}; developed and tested on Subscription Edition.` },
  { label: 'Price', value: `${SHAREPOINT_PRICE.amount} USD ${SHAREPOINT_PRICE.unit}, including ${SHAREPOINT_PRICE.includes}. UserTasks itself is free and open source.` },
  { label: 'Deployment', value: 'Production-ready self-hosted next to the farm (Docker or Kubernetes) or fully air-gapped; UserTasks Cloud, through an outbound-only gateway, is in beta.' },
  { label: 'Installation', value: "A high-trust, provider-hosted SharePoint add-in installed from the farm's own App Catalog with a generated PowerShell script; no SharePoint Store." },
  { label: 'Sign-in', value: 'Silent single sign-on through the identity provider SharePoint already uses (AD FS or Windows sign-in): no UserTasks login screen.' },
  { label: 'Migration', value: 'Importers for InfoPath .xsn templates (free, in core) and SharePoint Designer 2010 workflows (in the extension), and Nintex .nwf / .nwp workflows (free, in core; SharePoint targets with the extension).' },
]

/** Dated Microsoft facts for SharePoint Server and SharePoint Online, newest last. */
export const SHAREPOINT_TIMELINE: Array<{ date: string; text: string; source: Source; highlight?: boolean }> = [
  { date: 'November 1, 2020', text: 'SharePoint 2010 workflows retired in SharePoint Online.', source: MS.sp2010Retirement },
  { date: 'April 2, 2026', text: 'SharePoint 2013 workflows fully retired in SharePoint Online, with no option to extend.', source: MS.sp2013Retirement },
  { date: 'July 14, 2026', text: 'SharePoint Server 2016 and 2019, SharePoint Designer 2013 and InfoPath 2013 reached the end of extended support, and so did SharePoint 2010 workflows and InfoPath Forms Services in Subscription Edition.', source: MS.kb5002945 },
  { date: 'September 2026', text: 'SharePoint 2010 workflows and InfoPath Forms Services turned off by default in Subscription Edition, from that month’s public update.', source: MS.kb5002945 },
  { date: 'July 13, 2027', text: 'The public update removes SharePoint 2010 workflows and InfoPath Forms Services from SharePoint Server Subscription Edition.', source: MS.kb5002945, highlight: true },
]

/**
 * The options a SharePoint Server team weighs, side by side. Facts only:
 * what each option is, where it runs and what its vendor publishes. "Varies"
 * or a pointer to the vendor wherever we can't state a fact.
 */
export const ALTERNATIVES_COMPARISON = {
  title: 'UserTasks, staying on 2010 / 2013 workflows, Power Automate and Nintex compared',
  body: 'The options SharePoint Server teams usually weigh, stated as facts from each vendor’s own pages. One fact matters most for Nintex customers: Nintex for SharePoint workflows run on the SharePoint 2010 workflow engine, which Microsoft removes from Subscription Edition with the July 13, 2027 update. UserTasks moves those workflows onto its own open-source engine, independent of SharePoint and built to scale out.',
  columns: ['', 'UserTasks with the SharePoint extension', 'Staying on SharePoint 2010 / 2013 workflows', 'Power Automate', 'Nintex for SharePoint'] as [string, string, string, string, string],
  rows: [
    ['What it is', 'Open-source workflow, forms and tasks platform plus a paid SharePoint Server add-in', 'The workflow engines built into SharePoint Server, authored with SharePoint Designer', 'Microsoft’s cloud workflow service, recommended by Microsoft as the replacement for classic workflows', 'A commercial workflow and forms product that installs into SharePoint Server; Nintex says its on-premises workflows are built on the SharePoint 2010 workflow engine'],
    ['Runs where', 'Your servers (Docker, Kubernetes, air-gapped; production-ready) or UserTasks Cloud (beta)', 'Inside the SharePoint farm', 'Microsoft cloud; reaches on-premises SharePoint 2016 or 2019 farms through the on-premises data gateway', 'Inside the SharePoint farm; Nintex documents a SharePoint Subscription Edition version'],
    ['Workflow engine', 'Its own open-source engine (Apache-2.0), independent of SharePoint’s workflow engines: a durable queue with workers you add to scale out', 'SharePoint 2010 workflow engine, or SharePoint Workflow Manager for 2013 workflows', 'Microsoft’s cloud service', 'The SharePoint 2010 workflow engine (per Nintex)'],
    ['Support status', 'Supported; updates and support included in the licence', '2010 workflows: out of support since July 14, 2026 and removed from Subscription Edition by the July 13, 2027 update. 2013 workflows: supported on Subscription Edition with SharePoint Workflow Manager', 'Supported by Microsoft', 'Depends on the SharePoint 2010 workflow engine: out of Microsoft support since July 14, 2026, off by default since the September 2026 update, and removed from Subscription Edition by the July 13, 2027 update, after which Nintex for SharePoint workflows there stop running'],
    ['Forms', 'Generated New, Edit and Display forms embedded in SharePoint; InfoPath .xsn import', 'InfoPath forms (InfoPath Forms Services leaves Subscription Edition with 2010 workflows)', 'Separate product (Power Apps)', 'Nintex Forms'],
    ['Air-gapped networks', 'Yes, from a signed offline bundle', 'Yes, on the farm', 'No: a cloud service', 'See Nintex'],
    ['Price', '$7,500 USD per farm per year; UserTasks core is free (Apache-2.0)', 'Included with SharePoint Server', 'Microsoft licensing', 'Nintex licensing'],
    ['Migration help', 'InfoPath, SharePoint Designer 2010 and Nintex importers; imported Nintex workflows run on the UserTasks engine', '—', 'Microsoft migration guidance', 'See Nintex'],
  ],
  note: 'Sources: Microsoft KB5002945, Microsoft’s classic workflow migration guidance and the Power Platform SharePoint connector reference, and Nintex’s documentation and August 2026 notice for SharePoint Subscription Edition. Product names are trademarks of their owners.',
  sources: [MS.kb5002945, MS.powerAutomateMigration, MS.sharePointConnector, NINTEX_SE_DOCS, NINTEX_2010_ENGINE],
}

/** The /sharepoint FAQ (also FAQPage structured data and /llms-full.txt). */
export const SHAREPOINT_FAQS: Array<{ question: string; answer: string }> = [
  { question: "Can I try the SharePoint extension for free?", answer: "Yes. Start a 30-day free trial at usertasks.com/sharepoint/trial or from Settings → Extensions in self-hosted UserTasks: enter your name, work email, company and the farm ID ((Get-SPFarm).Id), and you get a signed trial licence for that farm at once. No card is needed. There is one trial per farm and one per company email domain, and air-gapped farms can copy a request code and paste the licence back." },
  { question: "What happens when the SharePoint trial ends?", answer: "The extension stops 24 hours after the trial expires, with warnings from 7 days before. Lists that use UserTasks forms automatically go back to SharePoint's own forms so nobody is stuck, and workflows started by SharePoint events pause. Nothing is deleted: when you add a licence ($7,500 USD per farm per year), the same forms are put back exactly as they were and the paused workflows resume." },
  { question: "What is the UserTasks SharePoint extension?", answer: "It is a paid extension for UserTasks, the open-source forms and workflow platform, that connects it to SharePoint Server 2016, 2019 and Subscription Edition. A provider-hosted add-in puts a UserTasks button on your lists, generates forms that open inside SharePoint, starts workflows from list events, exposes the SharePoint REST API as workflow steps and imports InfoPath and SharePoint Designer 2010 work." },
  { question: "Is Microsoft removing workflows from SharePoint Server?", answer: "Yes, for SharePoint 2010 workflows. Microsoft's notes for the November 10, 2026 Subscription Edition update (KB5002945) say the July 13, 2027 public update removes SharePoint 2010 workflows and InfoPath Forms Services from Subscription Edition. Both reached end of support on July 14, 2026 and have been turned off by default since the September 2026 public update. Microsoft advises anyone still using them to migrate now." },
  { question: "How do I replace SharePoint 2010 workflows on SharePoint Server Subscription Edition?", answer: "Install the UserTasks add-in from your farm's App Catalog, click UserTasks on the list the old workflow ran on, and create a workflow for the same event (for example Item created). Rebuild the steps in the designer, or import the SharePoint Designer 2010 workflow, test it on a few items, publish, then remove the old workflow association. Lists, libraries and their content stay where they are." },
  { question: "What is a good SharePoint Designer workflow alternative on premises?", answer: "One that runs next to the farm, starts from the same list events and keeps approvals inside SharePoint. UserTasks does that: workflows start on item created, modified, deleted, renamed, approval and version events, approvals arrive in a My tasks web part and the UserTasks task list, and the designer opens inside a SharePoint page. It can run self-hosted or air-gapped." },
  { question: "What about SharePoint 2013 workflows?", answer: "On Subscription Edition, Microsoft still supports SharePoint 2013 workflows with SharePoint Workflow Manager, which follows the support timeline of SharePoint Server. They are already retired in SharePoint Online (April 2, 2026), SharePoint Designer 2013 left support on July 14, 2026, and the classic Microsoft Workflow Manager's support as a SharePoint component ended the same day. Many teams move them together with their 2010 workflows." },
  { question: "Which SharePoint versions does it support?", answer: "SharePoint Server 2016, SharePoint Server 2019 and SharePoint Server Subscription Edition. It is developed and tested on Subscription Edition. Note that Microsoft ended extended support for SharePoint Server 2016 and 2019 on July 14, 2026; Subscription Edition follows Microsoft's Modern Lifecycle Policy and is in support." },
  { question: "Do people have to sign in to UserTasks?", answer: "No. Clicking UserTasks in SharePoint signs people in silently through the identity provider SharePoint already uses, such as AD FS or Windows sign-in. They never see a UserTasks login screen, and forms open inside the SharePoint page with the site's own header and navigation." },
  { question: "Do we need the SharePoint Store or internet access?", answer: "No. The add-in is installed from your farm's own App Catalog with a generated PowerShell script. With self-hosted UserTasks, which is production-ready, everything stays in your network. With UserTasks Cloud, which is in beta, a small Windows gateway makes outbound-only HTTPS connections, so you open no inbound firewall ports." },
  { question: "Can it run on an air-gapped network?", answer: "Yes. UserTasks makes no outbound calls at runtime (no SaaS, CDN or telemetry). You receive one signed bundle with the UserTasks images (SharePoint extension included), the database and storage it needs, the Helm chart, Docker Compose files, the CLI and the documentation. Verify it, carry it across, and install with Docker Compose or Kubernetes. The SharePoint licence is checked offline from a signed licence file, and the add-in installs from your farm's App Catalog. Our release checks prove the full install on a host with no internet access." },
  { question: "Can we go back to SharePoint's original forms?", answer: "Yes. Generated UserTasks forms replace a list's New, Edit and Display forms, whether they were SharePoint's own or InfoPath forms, and you can restore the originals at any time. Save, Delete and Cancel on a UserTasks form return people to the list, just as before, so switching back and forth is painless." },
  { question: "Can I see metrics for the workflows and forms on a list?", answer: "Yes. The UserTasks button opens a dashboard for the list: runs started, success rate, open runs, average and p95 duration and form submissions for 7, 30 or 90 days; runs per day by outcome; cycle time; where runs are waiting, by step and by person; submissions per form; and a per-workflow report you can download as CSV. A Runs tab lists every run with filters, search, cancel and run again." },
  { question: "Who can set up workflows and forms on a list?", answer: "By default UserTasks follows SharePoint permissions: anyone with Manage Lists on a list can set up and manage that list's forms and workflows, and only that list's, checked again on the server for every action and audited. UserTasks admins can do everything. A workspace setting switches to UserTasks roles only. The list's Permissions tab shows who can change and use each form and workflow, next to the list's SharePoint permissions." },
  { question: "Can people start a workflow by hand on an item?", answer: "Yes. \u201cStart a UserTasks workflow\u201d appears on the item menu of a connected list or library. It opens a short page where the person picks the workflow and can add a note for the run; the run records who started it. Workflows can also be started from the list's dashboard." },
  { question: "Is UserTasks a Nintex alternative for SharePoint on premises?", answer: "For workflows, forms and approvals on SharePoint Server lists, yes: UserTasks starts workflows from list events, replaces list forms and runs next to the farm. The free Nintex importer in UserTasks core reads .nwf and .nwp exports and imports them as draft workflows, with SharePoint lists as targets; actions without an equivalent come in as placeholders to rebuild. UserTasks does not include RPA." },
  { question: "How much does it cost?", answer: "$7,500 USD per SharePoint farm per year, including every update released during the year and support. UserTasks itself is open source under Apache-2.0; the SharePoint extension is the paid part. Contact us to get a licence or to plan a trial on your farm." },
]
