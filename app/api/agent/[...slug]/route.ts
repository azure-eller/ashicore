import { NextResponse } from "next/server";

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
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
