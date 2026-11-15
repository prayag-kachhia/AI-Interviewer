import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Compass,
  BookOpen,
  ArrowRight,
  ExternalLink,
  AlertCircle,
  Loader2,
  TrendingUp,
  Sparkles,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { getInsights } from '../../lib/api';
import type { ImprovementPlan, LearningResource, TopicPlan, TopicScore } from '../../types';

export const GuidePage: React.FC = () => {
  const [plan, setPlan] = useState<ImprovementPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    async function fetchPlan() {
      try {
        setLoading(true);
        setError(null);
        setNotFound(false);
        const data = await getInsights();
        if (!cancelled) {
          if (!data || ((!data.topics || data.topics.length === 0) && (!data.plan || data.plan.length === 0))) {
            setNotFound(true);
          } else {
            setPlan(data);
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          if (err?.response?.status === 404 || err?.status === 404) {
            setNotFound(true);
          } else {
            setError(err?.response?.data?.message || err?.message || 'Failed to load improvement guide');
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchPlan();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-16 flex flex-col items-center justify-center gap-4" role="status">
        <Loader2 className="size-8 motion-safe:animate-spin text-primary" />
        <p className="text-muted-foreground text-sm font-medium">Loading improvement guide…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <Alert variant="error">
          <AlertCircle className="size-5" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (notFound || !plan) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <Card className="text-center p-8">
          <CardHeader className="flex flex-col items-center gap-2">
            <div className="rounded-full bg-secondary p-3 text-muted-foreground mb-2">
              <Compass className="size-8" />
            </div>
            <CardTitle className="text-2xl">No Improvement Guide Yet</CardTitle>
            <CardDescription className="max-w-md mx-auto">
              You don&apos;t have an improvement plan yet. Complete mock interviews to evaluate your strengths and generate a personalized study roadmap.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 flex justify-center">
            <Button onClick={() => navigate('/new-interview')} className="gap-2">
              Start an Interview
              <ArrowRight className="size-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Filter weak topics (score <= 3) for the weaknesses section, sorted lowest score first
  const weakTopics = [...(plan.topics || [])]
    .filter((t) => t.score <= 3)
    .sort((a, b) => a.score - b.score);

  // If no topics are <= 3, show all evaluated topics
  const topicsToDisplay = weakTopics.length > 0 ? weakTopics : plan.topics;

  // Flatten actions from topic plans for the roadmap
  const roadmapItems = (plan.plan || []).flatMap((tp: TopicPlan) =>
    (tp.actions || []).map((action) => ({
      ...action,
      topic: tp.topic,
      topicScore: tp.score,
    }))
  );

  // Collect resources list
  const resourcesList: LearningResource[] = plan.resources && plan.resources.length > 0
    ? plan.resources
    : roadmapItems
        .map((item) => item.resource)
        .filter((r): r is LearningResource => Boolean(r));

  // Deduplicate resources by ID
  const uniqueResources = Array.from(
    new Map(resourcesList.map((r) => [r.id, r])).values()
  );

  const getScoreBadgeVariant = (score: number) => {
    if (score <= 2) return 'error' as const;
    if (score === 3) return 'pending' as const;
    return 'success' as const;
  };

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 flex flex-col gap-8">
      {/* Page Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-primary font-medium text-sm">
          <Sparkles className="size-4" />
          <span>Candidate Improvement Plan</span>
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
          Improvement Guide
        </h1>
        <p className="text-muted-foreground text-base max-w-3xl">
          Review your identified technical weaknesses, follow your ordered preparation roadmap, and dive into hand-vetted study resources.
        </p>
      </div>

      {/* 1. Weaknesses Section */}
      <section aria-labelledby="weaknesses-heading" className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 id="weaknesses-heading" className="font-display text-xl font-semibold flex items-center gap-2">
            <TrendingUp className="size-5 text-primary" />
            Topic Weaknesses
          </h2>
          <Badge variant="secondary">
            {topicsToDisplay.length} {topicsToDisplay.length === 1 ? 'topic' : 'topics'} evaluated
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {topicsToDisplay.map((topic: TopicScore) => (
            <Card key={topic.topic} className="flex flex-col justify-between">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-lg">{topic.topic}</CardTitle>
                  <Badge variant={getScoreBadgeVariant(topic.score)}>
                    Score: {topic.score} / 5
                  </Badge>
                </div>
                {topic.summary && (
                  <CardDescription className="text-sm mt-1">
                    {topic.summary}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Proficiency</span>
                    <span>{Math.round((topic.score / 5) * 100)}%</span>
                  </div>
                  <Progress
                    value={(topic.score / 5) * 100}
                    max={100}
                    aria-label={`${topic.topic} proficiency progress`}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* 2. Roadmap Section */}
      <section aria-labelledby="roadmap-heading" className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 id="roadmap-heading" className="font-display text-xl font-semibold flex items-center gap-2">
            <Compass className="size-5 text-primary" />
            Improvement Roadmap
          </h2>
          <Badge variant="default">
            {roadmapItems.length} {roadmapItems.length === 1 ? 'action item' : 'action items'}
          </Badge>
        </div>

        {roadmapItems.length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground">
            No roadmap actions currently generated.
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {roadmapItems.map((item, index) => (
              <Card key={item.id || index} className="py-4">
                <CardContent className="flex flex-col md:flex-row md:items-center justify-between gap-4 py-0">
                  <div className="flex items-start gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-foreground">
                      {index + 1}
                    </span>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline">{item.topic}</Badge>
                        <span className="font-medium text-sm text-foreground">
                          {item.action}
                        </span>
                      </div>
                      {item.resource && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                            {item.resource.type}
                          </Badge>
                          <span>{item.resource.title}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 self-end md:self-auto shrink-0">
                    <Badge variant={item.completed ? 'success' : 'pending'}>
                      {item.completed ? 'Completed' : 'To do'}
                    </Badge>
                    {item.resource?.url && (
                      <a
                        href={item.resource.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
                      >
                        Open Resource
                        <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* 3. Resources Section */}
      <section aria-labelledby="resources-heading" className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 id="resources-heading" className="font-display text-xl font-semibold flex items-center gap-2">
            <BookOpen className="size-5 text-primary" />
            Curated Learning Resources
          </h2>
          <Badge variant="secondary">
            {uniqueResources.length} {uniqueResources.length === 1 ? 'resource' : 'resources'}
          </Badge>
        </div>

        {uniqueResources.length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground">
            No specific resources linked to this plan.
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {uniqueResources.map((res: LearningResource) => (
              <Card key={res.id} className="flex flex-col justify-between">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline">{res.topic}</Badge>
                    <Badge variant="secondary" className="capitalize text-xs">
                      {res.type}
                    </Badge>
                  </div>
                  <CardTitle className="text-base font-semibold mt-1">
                    {res.title}
                  </CardTitle>
                  <CardDescription className="text-xs line-clamp-2">
                    {res.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <a
                    href={res.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-primary font-medium hover:underline"
                  >
                    Study Resource
                    <ExternalLink className="size-3.5" />
                  </a>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
