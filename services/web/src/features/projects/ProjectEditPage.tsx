import { ProjectId } from "@unhalteproblem.de/api";
import { Option, Schema } from "effect";
import { useNavigate, useParams } from "react-router";
import { AsyncView } from "#api/AsyncView.tsx";
import { NotFoundPage } from "#app/NotFoundPage.tsx";
import { RequireUser } from "#app/RequireUser.tsx";
import { Container } from "#ui/Container.tsx";
import { Loading } from "#ui/Spinner.tsx";
import { editProjectPath, managedProjectAtom } from "./projectAtoms.ts";
import { ProjectEditor } from "./ProjectEditor.tsx";

const decodeId = Schema.decodeUnknownOption(ProjectId);

/** A new project (`/projects/~new`), or any project by id, hidden ones included. */
export function ProjectEditPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const done = () => navigate("/admin/projects");
  return (
    <RequireUser role="admin">
      {() => (
        <Container width="prose">
          {projectId === undefined ? (
            <ProjectEditor
              project={null}
              onSaved={(saved) =>
                navigate(editProjectPath(saved.id), { replace: true })
              }
              onClose={done}
              onDeleted={done}
            />
          ) : (
            <Existing id={projectId} onDone={done} />
          )}
        </Container>
      )}
    </RequireUser>
  );
}

function Existing({
  id,
  onDone,
}: {
  readonly id: string;
  readonly onDone: () => void;
}) {
  const projectId = decodeId(id);
  if (Option.isNone(projectId)) return <NotFoundPage what="project" />;
  return (
    <AsyncView
      atom={managedProjectAtom(projectId.value)}
      loading={<Loading label="opening editor" />}
      failure={(error) =>
        error === "ProjectNotFound" ? (
          <NotFoundPage what="project" />
        ) : undefined
      }
    >
      {(project) => (
        <ProjectEditor
          key={project.id}
          project={project}
          onSaved={() => {}}
          onClose={onDone}
          onDeleted={onDone}
        />
      )}
    </AsyncView>
  );
}
