export type PostMetadata = {
  title: string;
  date: string;
  slug: string;
  excerpt: string;
};

export type PostModule = {
  metadata: PostMetadata;
  default: () => JSX.Element;
};

import * as theLogsDontLie from "./2025-12-15-The-Logs-Dont-Lie-But-I-Do";

const rawPosts: PostModule[] = [theLogsDontLie];

export const posts: PostModule[] = [...rawPosts].sort(
  (a, b) => new Date(b.metadata.date).getTime() - new Date(a.metadata.date).getTime(),
);

export const getLatestPost = () => posts[0];

export const getPostBySlug = (slug: string) => posts.find((post) => post.metadata.slug === slug);
