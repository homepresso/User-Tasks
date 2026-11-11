import { AlarmClock, BellRing, CheckCheck, Eye, History, Inbox, ListFilter, MessageSquare, Paperclip, ShieldCheck, Smartphone, UserCog, Users } from "lucide-react"
import { DocLinks, FaqList, FeatureCard, MarketingFooter, MarketingHeader, SectionHeading, Shot } from "@/components/marketing/marketing-ui"
import { ProductHero } from "@/components/marketing/product-hero"
import { FormsTasksShowcase } from "@/components/marketing/forms-tasks-showcase"
import { SCREENSHOTS } from "@/lib/docs/screenshots"
import { TASKS_PAGE } from "@/lib/marketing-pages"

/**
 * /tasks-and-approvals — the people side: the task list, approvals, team
 * queues, SLAs, the process view and timeline, acting on behalf. The hero
 * plays the end-user demo; the sections use real screenshots.
 */

const SITE_URL = "https://usertasks.com"

const ACTIONS = [
  { icon: CheckCheck, title: "Approve, reject or request changes", body: "Outcomes are buttons on the form, each with the comment and fields it needs. The workflow branches on the answer." },
  { icon: Users, title: "Team queues", body: "Work lands in a queue; whoever accepts it owns it. Queue rules sort, filter and route what each person sees." },
  { icon: UserCog, title: "Redirect or act on behalf", body: "Hand a task to someone else, or let a manager act for an absent assignee with a reason that goes on the record." },
  { icon: AlarmClock, title: "SLAs and escalation", body: "Due dates, reminders before or after they pass and escalation of overdue work, all recorded." },
  { icon: Eye, title: "Process view", body: "Every request shows the path it took, who has it now and what comes next, on the same canvas the designer drew." },
  { icon: History, title: "Timeline and audit", body: "Submitted, assigned, commented, approved: each event with who and when, kept with retention policies you set." },
  { icon: Paperclip, title: "Attachments", body: "Files on the task and in its form, previewed in place and passed to the next step." },
  { icon: Smartphone, title: "On phones", body: "Cards instead of tables, the same form and the same buttons. Approve from wherever you are." },
]

const FAQS = [
  { question: "Where do people see their tasks?", answer: "In one task list in UserTasks, on desktop and phones, with the tasks assigned to them and the queues of their teams. If you would rather show tasks in your own application, the same list, actions and forms are available through the REST API." },
  { question: "How does an approval reach the right person?", answer: "A User Task step in the workflow assigns it to a person or a team, or to someone taken from the form or worked out by a decision table. Several assignees can be asked at once, with rules for how many must answer." },
  { question: "What happens when someone does not respond?", answer: "Each task can have a due date and an SLA. Reminders go out before or after it is due, overdue work is escalated, and people can redirect a task to someone better placed to answer it." },
  { question: "Can a manager act for someone who is away?", answer: "Yes, if their role allows it. They act on behalf of the assignee and must give a reason, which is recorded in the timeline and the audit log." },
  { question: "Can the Agent approve tasks?", answer: "Only when the person asks it to and then confirms. The Agent fills in any required fields first and shows a confirmation card; the approval is recorded as the person's, made with the Agent's help." },
]

export function TasksPage() {
  const page = TASKS_PAGE
  const url = `${SITE_URL}/${page.slug}`
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": `${url}#webpage`, url, name: page.title, description: page.description, isPartOf: { "@id": `${SITE_URL}/#website` }, about: { "@id": `${SITE_URL}/#software` }, primaryImageOfPage: `${SITE_URL}${SCREENSHOTS["tasks-queue"].src}` },
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "UserTasks", item: SITE_URL }, { "@type": "ListItem", position: 2, name: "Tasks and approvals", item: url }] },
      { "@type": "FAQPage", mainEntity: FAQS.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) },
    ],
  }

  return (
    <div className="mkt relative min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <MarketingHeader tone="night" />
      <main>
        <ProductHero
          crumb="Tasks and approvals"
          eyebrow="Tasks and approvals"
          icon={Inbox}
          title={<>Approvals that <span className="mkt-gradient-text">chase themselves.</span></>}
          intro={<>Everything someone needs to do lands in <strong className="text-white">one task list</strong>: approvals, reviews, data to fill in. Open it, see where the request has been, decide with a comment, and the process moves on. Reminders and escalation do the chasing.</>}
          primary={{ href: "/docs/tasks", label: "Read the tasks guide" }}
          secondary={{ href: "/start", label: "Start free" }}
          scenes={["inbox", "task", "process", "timeline", "approve"]}
          demoLabel="Get work done: a purchase request from the task list to approved"
          bullets={["Approve, reject or request changes", "Team queues, SLAs and escalation", "A process view and timeline on every request"]}
        />

        <section id="actions" className="scroll-mt-24">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
            <SectionHeading eyebrow="For the people doing the work" title="Everything a decision needs, on one screen.">
              The form, its attachments, the path so far and the people involved. One click to decide, with the comment the next person needs.
            </SectionHeading>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {ACTIONS.map((action) => <FeatureCard key={action.title} icon={action.icon} title={action.title}>{action.body}</FeatureCard>)}
            </div>
            <DocLinks links={[{ href: "/docs/tasks/fields-and-outcomes", label: "Fields and outcomes" }, { href: "/docs/tasks/assignment-and-slas", label: "Assignment and SLAs" }, { href: "/docs/tasks/manager-view", label: "The manager view" }, { href: "/docs/tasks/api", label: "Tasks API" }]} />
          </div>
        </section>

        <section className="border-y border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/60">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <SectionHeading eyebrow="Team queues" title="Work that picks itself up.">
                Send work to a team rather than a person. Each member sees the queue, accepts what they take on and the rest stays visible until someone does. Queue rules decide who sees what, in which order.
              </SectionHeading>
              <ul className="mt-6 space-y-2 text-[15px] text-(color:--mkt-ink-soft)">
                {[["Accept, decline, hold, redirect or escalate", ListFilter], ["Reminders before a task is due", BellRing], ["Comments and mentions on the task", MessageSquare], ["Every action in the audit trail", ShieldCheck]].map(([text, Icon]) => {
                  const I = Icon as typeof Inbox
                  return <li key={text as string} className="flex items-center gap-3"><I size={16} className="text-(color:--mkt-bronze)" aria-hidden="true" />{text as string}</li>
                })}
              </ul>
            </div>
            <Shot name="tasks-queue" alt="The task queue with tasks waiting to be accepted by members of the team" sizes="(min-width: 1152px) 640px, 100vw" />
          </div>
        </section>

        <section>
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.1fr_0.9fr]">
            <Shot name="home-view-flow" alt="The process view of a request from the home page: the steps it has passed, the step it waits on and who has it" sizes="(min-width: 1152px) 640px, 100vw" />
            <div>
              <SectionHeading eyebrow="Process view and timeline" title="Nobody has to ask where it is.">
                Requesters, assignees and managers see the same picture: the path the request took, the step it is on, who has it and how long it has waited.
              </SectionHeading>
            </div>
          </div>
        </section>

        <FormsTasksShowcase />

        <div className="border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-sand)/50"><FaqList faqs={FAQS} /></div>
      </main>
      <MarketingFooter />
    </div>
  )
}
