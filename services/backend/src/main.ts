import { NodeRuntime } from "@effect/platform-node";
import { Layer } from "effect";
import { Server } from "./Server.ts";

Layer.launch(Server).pipe(NodeRuntime.runMain);
