import { jsonNotFound } from "@/lib/api/responses";

function notFound() {
  return jsonNotFound();
}

export function GET() {
  return notFound();
}

export function POST() {
  return notFound();
}

export function PUT() {
  return notFound();
}

export function PATCH() {
  return notFound();
}

export function DELETE() {
  return notFound();
}
