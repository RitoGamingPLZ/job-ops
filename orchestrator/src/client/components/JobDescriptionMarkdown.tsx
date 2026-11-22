import type React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getSafeJobDescriptionHref } from "@client/lib/jobDescription";
import { cn } from "@/lib/utils";

interface JobDescriptionMarkdownProps {
  className?: string;
  description: string;
}

export const JobDescriptionMarkdown: React.FC<JobDescriptionMarkdownProps> = ({
  className,
  description,
}) => {
  return (
    <div className={cn("max-w-none prose dark:prose-invert dark:prose-a:text-primary", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: () => null,
          a: ({ children, href, ...props }) => {
            const safeHref = getSafeJobDescriptionHref(href);
            if (!safeHref) return <span>{children}</span>;

            return (
              <a {...props} href={safeHref} target="_blank" rel="noopener noreferrer nofollow">
                {children}
              </a>
            );
          },
        }}
      >
        {description}
      </ReactMarkdown>
    </div>
  );
};
