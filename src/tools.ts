import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "./config.js";
import type { GolfBoxClient } from "./golfbox/types.js";

const holeCountSchema = z.union([z.literal(9), z.literal(18)]);

const playerSchema = z.object({
  name: z.string().min(1),
  golfId: z.string().optional(),
  email: z.string().email().optional()
});

function jsonResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

function assertWriteToolsEnabled(config: AppConfig): void {
  if (!config.enableWriteTools) {
    throw new Error("Write tools are disabled. Set GOLFBOX_ENABLE_WRITE_TOOLS=true to allow booking or cancellation.");
  }
}

function assertConfirmed(confirmedByUser: boolean, confirmationText?: string): void {
  if (!confirmedByUser) {
    throw new Error("This action requires confirmedByUser=true.");
  }

  if (!confirmationText || !confirmationText.toLowerCase().includes("book")) {
    throw new Error("confirmationText must explicitly state that the user wants to book this tee time.");
  }
}

export function registerGolfBoxTools(server: McpServer, client: GolfBoxClient, config: AppConfig): void {
  server.registerTool(
    "golfbox_authenticate",
    {
      title: "Authenticate GolfBox",
      description: "Authenticate with the configured GolfBox adapter and validate the token where supported.",
      inputSchema: {}
    },
    async () => jsonResult(await client.authenticate())
  );

  server.registerTool(
    "golfbox_list_clubs",
    {
      title: "List GolfBox clubs",
      description: "List clubs known by the configured GolfBox adapter.",
      inputSchema: {}
    },
    async () => jsonResult(await client.listClubs())
  );

  server.registerTool(
    "golfbox_search_tee_times",
    {
      title: "Search tee times",
      description: "Search available tee times for a club and date.",
      inputSchema: {
        clubId: z.string().min(1),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        players: z.number().int().min(1).max(4),
        holes: holeCountSchema.optional(),
        earliestTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        latestTime: z.string().regex(/^\d{2}:\d{2}$/).optional()
      }
    },
    async (input) => jsonResult(await client.searchTeeTimes(input))
  );

  server.registerTool(
    "golfbox_list_bookings",
    {
      title: "List GolfBox bookings",
      description: "List tee-time bookings for the authenticated GolfBox user.",
      inputSchema: {}
    },
    async () => jsonResult(await client.listBookings())
  );

  server.registerTool(
    "golfbox_list_upcoming_tee_times",
    {
      title: "List upcoming GolfBox tee times",
      description: "List upcoming private tee times for the authenticated GolfBox user.",
      inputSchema: {
        fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        daysAhead: z.number().int().min(1).max(180).optional(),
        clubId: z.string().min(1).optional(),
        clubIds: z.array(z.string().min(1)).max(20).optional()
      }
    },
    async (input) => jsonResult(await client.listUpcomingTeeTimes(input))
  );

  server.registerTool(
    "golfbox_list_tournaments",
    {
      title: "List GolfBox tournaments",
      description: "List tournaments the authenticated GolfBox user is registered for or has participated in.",
      inputSchema: {}
    },
    async () => jsonResult(await client.listTournaments())
  );

  server.registerTool(
    "golfbox_prepare_booking",
    {
      title: "Prepare booking",
      description: "Validate and summarize a booking without creating it.",
      inputSchema: {
        slotId: z.string().min(1),
        players: z.array(playerSchema).min(1).max(4),
        holes: holeCountSchema.optional(),
        notes: z.string().max(1000).optional()
      }
    },
    async (input) => jsonResult(await client.prepareBooking(input))
  );

  server.registerTool(
    "golfbox_create_booking",
    {
      title: "Create booking",
      description: "Create a tee-time booking. Disabled unless write tools are explicitly enabled.",
      inputSchema: {
        slotId: z.string().min(1),
        players: z.array(playerSchema).min(1).max(4),
        holes: holeCountSchema.optional(),
        notes: z.string().max(1000).optional(),
        confirmedByUser: z.boolean(),
        confirmationText: z.string().min(1),
        idempotencyKey: z.string().min(8).max(128)
      }
    },
    async (input) => {
      assertWriteToolsEnabled(config);
      if (config.requireConfirmation) {
        assertConfirmed(input.confirmedByUser, input.confirmationText);
      }

      return jsonResult(await client.createBooking(input));
    }
  );

  server.registerTool(
    "golfbox_cancel_booking",
    {
      title: "Cancel booking",
      description: "Cancel a booking. Disabled unless write tools are explicitly enabled.",
      inputSchema: {
        bookingId: z.string().min(1),
        confirmedByUser: z.boolean(),
        reason: z.string().max(1000).optional()
      }
    },
    async (input) => {
      assertWriteToolsEnabled(config);
      if (config.requireConfirmation && !input.confirmedByUser) {
        throw new Error("This action requires confirmedByUser=true.");
      }

      return jsonResult(await client.cancelBooking(input));
    }
  );
}
