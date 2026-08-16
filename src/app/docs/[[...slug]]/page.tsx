import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import { source } from '@/lib/source';

const SECTION_LABEL: Record<string, string> = {
  'start-here': 'Start Here',
  quickstart: 'Quickstart',
  concepts: 'Concepts',
  guides: 'Guides',
  'how-it-works': 'How it works',
  reference: 'Reference',
};

type Params = { params: Promise<{ slug?: string[] }> };

export default async function Page(props: Params) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const section = params.slug?.[0];
  const eyebrow = section ? (SECTION_LABEL[section] ?? 'Docs') : 'Docs';

  return (
    // Fumadocs renders the page body as an `<article>` and the docs shell has no
    // `<main>` of its own, so the article carries the main landmark and the id
    // the site-wide skip link points at.
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      id="content"
      role="main"
      tabIndex={-1}
      className="focus:outline-none"
    >
      <span className="mb-5 inline-flex w-fit items-center gap-2 border border-violet/40 bg-violet/[0.07] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-violet-soft">
        <span className="size-1.5 bg-cyan" />
        {eyebrow}
      </span>
      <DocsTitle className="font-display tracking-tight">{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody className="zen-prose">
        <MDX components={getMDXComponents({ a: createRelativeLink(source, page) })} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
