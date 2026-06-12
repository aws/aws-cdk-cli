import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Grid from '@cloudscape-design/components/grid';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import * as React from 'react';
import { FilePane } from './components/FilePane';

/** Web explorer shell: Resource Tree (left), two file panes, Violations (bottom). Tree/violations are placeholders until the cloud-assembly reader is wired in. */
export function App(): JSX.Element {
  return (
    <ContentLayout
      header={
        <Header variant="h1" description="last updated: —">
          CDK Web Explorer
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Grid gridDefinition={[{ colspan: 3 }, { colspan: 9 }]}>
          <Container header={<Header variant="h2">Resource Tree</Header>}>
            <Box color="text-status-inactive">
              Construct tree appears here once the cloud-assembly reader is wired in.
            </Box>
          </Container>
          <Grid gridDefinition={[{ colspan: 6 }, { colspan: 6 }]}>
            <FilePane title="file 1" />
            <FilePane title="file 2" />
          </Grid>
        </Grid>
        <Container header={<Header variant="h2">Violations</Header>}>
          <Box color="text-status-inactive">
            Policy-validation violations appear here once the cloud-assembly reader is wired in.
          </Box>
        </Container>
      </SpaceBetween>
    </ContentLayout>
  );
}
