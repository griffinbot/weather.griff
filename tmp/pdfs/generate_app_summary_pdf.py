from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "weather-griff-app-summary.pdf"


def build_styles():
    styles = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "Title",
            parent=styles["Title"],
            fontName="Helvetica-Bold",
            fontSize=21,
            leading=24,
            textColor=colors.HexColor("#0F172A"),
            spaceAfter=4,
            alignment=TA_LEFT,
        ),
        "subtitle": ParagraphStyle(
            "Subtitle",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=9.6,
            leading=11.6,
            textColor=colors.HexColor("#475569"),
            spaceAfter=12,
        ),
        "section": ParagraphStyle(
            "Section",
            parent=styles["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=11.4,
            leading=13.2,
            textColor=colors.HexColor("#1D4ED8"),
            spaceBefore=5,
            spaceAfter=4,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=9.35,
            leading=11.7,
            textColor=colors.HexColor("#111827"),
            spaceAfter=4,
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=9.05,
            leading=11.1,
            leftIndent=10,
            firstLineIndent=-8,
            textColor=colors.HexColor("#111827"),
            spaceAfter=2,
        ),
        "footer": ParagraphStyle(
            "Footer",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=7.5,
            leading=9,
            textColor=colors.HexColor("#64748B"),
        ),
    }


def bullet(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(f"- {text}", style)


def section(title: str, items, heading_style, body_style):
    flowables = [Paragraph(title, heading_style)]
    for item in items:
        flowables.append(item)
    return KeepTogether(flowables)


def draw_page(canvas, doc):
    width, height = LETTER
    canvas.saveState()
    canvas.setFillColor(colors.HexColor("#E8F0FF"))
    canvas.rect(0, height - 58, width, 58, stroke=0, fill=1)
    canvas.setStrokeColor(colors.HexColor("#DBE3F0"))
    canvas.line(doc.leftMargin, 38, width - doc.rightMargin, 38)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawString(
        doc.leftMargin,
        25,
        "Evidence basis: package.json, DEPLOYMENT.md, app/*, app/hooks/*, app/services/weatherProxy.ts, functions/api/*, functions/_lib/*",
    )
    canvas.restoreState()


def build_pdf():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    styles = build_styles()
    story = []

    story.append(Paragraph("Griff Weather", styles["title"]))
    story.append(
        Paragraph(
            "One-page app summary based only on repository evidence.",
            styles["subtitle"],
        )
    )

    story.append(
        section(
            "What it is",
            [
                Paragraph(
                    "Griff Weather is a React/Vite weather briefing app centered on airport or city search, current conditions, winds aloft, and aviation weather products. Repo evidence shows it is designed to run on Cloudflare Pages with a `/api/*` proxy layer in Pages Functions.",
                    styles["body"],
                )
            ],
            styles["section"],
            styles["body"],
        )
    )

    story.append(
        section(
            "Who it's for",
            [
                Paragraph(
                    "Primary user (inferred from the aviation-focused UI and API usage): pilots and flight planners who need airport-centric weather, winds aloft, METAR/TAF, and forecast discussion data in one place.",
                    styles["body"],
                )
            ],
            styles["section"],
            styles["body"],
        )
    )

    story.append(
        section(
            "What it does",
            [
                bullet("Searches airports/cities and resolves saved locations with airport identifiers.", styles["bullet"]),
                bullet("Shows current conditions, sunrise/sunset, flight category, and expandable hourly forecast cards.", styles["bullet"]),
                bullet("Provides a 7-day outlook with daily summaries, wind details, and flight-condition cues.", styles["bullet"]),
                bullet("Fetches nearby-station METARs and TAFs, with decoded airport weather details.", styles["bullet"]),
                bullet("Loads the latest NWS Area Forecast Discussion for the selected location's forecast office.", styles["bullet"]),
                bullet("Visualizes winds aloft and simulated trajectory paths using forecast layers and balloon math helpers.", styles["bullet"]),
                bullet("Includes a built-in chat-style weather assistant that answers from current Open-Meteo-backed data.", styles["bullet"]),
            ],
            styles["section"],
            styles["body"],
        )
    )

    story.append(
        section(
            "How it works",
            [
                bullet("Frontend: a React single-page app in `app/` with tabbed panels wired from `app/App.tsx`.", styles["bullet"]),
                bullet("Hooks: `useWeather`, `useWindAloft`, and `useAviationWeather` fetch, normalize, and cache feature data for the UI.", styles["bullet"]),
                bullet("Client data layer: `app/services/weatherProxy.ts` deduplicates requests, keeps short-lived browser cache, and routes calls to `/api/*`.", styles["bullet"]),
                bullet("Edge API: Cloudflare Pages Functions in `functions/api/*` proxy Open-Meteo, weather.gov, AviationWeather, NOAA RAP, Nominatim/position, timezone, and optional TFR/elevation/alert services.", styles["bullet"]),
                bullet("Platform controls: `functions/api/_middleware.ts` and `functions/_lib/*` enforce strict CORS, GET-only access, Durable Object rate limits, upstream headers, and edge cache/stale fallback.", styles["bullet"]),
            ],
            styles["section"],
            styles["body"],
        )
    )

    story.append(
        section(
            "How to run",
            [
                bullet("Install prerequisites noted in `DEPLOYMENT.md`: Node, pnpm, and Cloudflare auth (`npx wrangler whoami`).", styles["bullet"]),
                bullet("Install dependencies: `pnpm install`.", styles["bullet"]),
                bullet("Build the app: `pnpm run build`.", styles["bullet"]),
                bullet("Set Cloudflare vars/secrets for deployment; required secrets called out in repo: `TIMEZONEDB_API_KEY` and `GOOGLE_ELEVATION_API_KEY`.", styles["bullet"]),
                bullet("Deploy with `npx wrangler pages deploy dist --project-name new-weather-app --config wrangler.jsonc`.", styles["bullet"]),
                bullet("Local `dev`/`start` command: Not found in repo.", styles["bullet"]),
            ],
            styles["section"],
            styles["body"],
        )
    )

    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=LETTER,
        leftMargin=0.58 * inch,
        rightMargin=0.58 * inch,
        topMargin=0.82 * inch,
        bottomMargin=0.72 * inch,
    )
    doc.build(story, onFirstPage=draw_page)


if __name__ == "__main__":
    build_pdf()
