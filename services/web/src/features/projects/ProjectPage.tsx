import { useAtomValue } from "@effect/atom-react";
import type { PublishedProject } from "@unhalteproblem.de/api";
import { ArrowLeft, PenLine } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AsyncView } from "#api/AsyncView.tsx";
import { hasRole, userAtom } from "#api/session.ts";
import { NotFoundPage } from "#app/NotFoundPage.tsx";
import { toEditorContent } from "#editor/convert.ts";
import { RichDocument } from "#editor/RichDocument.tsx";
import { Button } from "#ui/Button.tsx";
import { Container } from "#ui/Container.tsx";
import { Loading } from "#ui/Spinner.tsx";
import {
  editProjectPath,
  managedProjectAtom,
  projectAtom,
} from "./projectAtoms.ts";
import { ProjectEditor } from "./ProjectEditor.tsx";
import { ProjectHeader } from "./ProjectHeader.tsx";

export function ProjectPage() {
  const slug = useParams().project;
  if (slug === undefined) return <NotFoundPage what="project" />;
  return <Project slug={slug} />;
}

function Project({ slug }: { readonly slug: string }) {
  const user = useAtomValue(userAtom);
  const [editing, setEditing] = useState(false);
  const navigate = useNavigate();
  return (
    <Container width="prose">
      <AsyncView
        atom={projectAtom(slug)}
        loading={<Loading />}
        failure={(error) =>
          error === "ProjectNotFound" ? (
            <NotFoundPage what="project" />
          ) : undefined
        }
      >
        {(project) =>
          editing ? (
            <AsyncView
              atom={managedProjectAtom(project.id)}
              loading={<Loading label="opening editor" />}
            >
              {(managed) => (
                <ProjectEditor
                  key={managed.id}
                  project={managed}
                  onSaved={(saved) => {
                    if (!saved.published) {
                      navigate(editProjectPath(saved.id), { replace: true });
                    } else if (saved.slug !== slug) {
                      navigate(`/projects/${saved.slug}`, { replace: true });
                    }
                  }}
                  onClose={() => setEditing(false)}
                  onDeleted={() => navigate("/projects")}
                />
              )}
            </AsyncView>
          ) : (
            <Reading
              project={project}
              onEdit={
                hasRole(user, "admin") ? () => setEditing(true) : undefined
              }
            />
          )
        }
      </AsyncView>
    </Container>
  );
}

function Reading({
  project,
  onEdit,
}: {
  readonly project: PublishedProject;
  readonly onEdit: (() => void) | undefined;
}) {
  return (
    <article className="animate-fade-up">
      <ProjectHeader
        status={project.status}
        tags={project.tags}
        repoUrl={project.repoUrl}
        liveUrl={project.liveUrl}
        coverImage={project.coverImage}
        aside={
          onEdit !== undefined && (
            <Button
              size="sm"
              variant="secondary"
              icon={<PenLine size={14} />}
              onClick={onEdit}
            >
              Edit in place
            </Button>
          )
        }
        title={
          <h1 className="text-4xl leading-tight font-semibold text-fg sm:text-5xl">
            {project.title}
          </h1>
        }
        summary={
          project.summary !== "" && (
            <p className="text-xl text-fg-soft">{project.summary}</p>
          )
        }
      />
      <RichDocument
        key={project.updatedAt.epochMilliseconds}
        content={toEditorContent(project.content)}
      />
      <footer className="mt-16 border-t border-border pt-6">
        <Link
          to="/projects"
          className="inline-flex items-center gap-2 font-mono text-sm text-muted hover:text-fg"
        >
          <ArrowLeft size={14} /> cd ~/projects
        </Link>
      </footer>
    </article>
  );
}
