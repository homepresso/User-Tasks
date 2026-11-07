import { ProjectDetailPage } from '@/components/org/project-detail'

/** /org/projects/[id] — one project and its team. */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ProjectDetailPage projectId={id} />
}
