import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre: ({ children }) => (
          <pre className="overflow-x-auto rounded bg-muted p-3 text-sm">
            {children}
          </pre>
        ),
        code: ({ className, children, ...props }) => {
          const isInline = !className;
          if (isInline) {
            return (
              <code
                className="rounded bg-muted px-1 text-sm"
                {...props}
              >
                {children}
              </code>
            );
          }
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
